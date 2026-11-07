// Alerts bundle seams — the daily pass's plans, the screen's `bundle` object and
// the switch. Every outside thing is a fake: no database, no send. One fictional
// client ("Sample" cards, "Sample Cedar LLC").
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planBundleAlerts, alertsBundlePayload, setBundleAlert, loadWeeklyFacts } from "./bundle.mjs";
import { FileAlertInputError } from "./store.mjs";

const ORG = "org-1";
const CLIENT = "client-1";
const NOW = new Date("2026-11-06T16:00:00Z");
const TODAY = "2026-11-06";

const CARDS = [
  { account_id: "card-a", name: "Sample Card A", mask: "4404", kind: "personal", balance_cents: 240000, limit_cents: 800000, used_pct: 30, due_on: "2026-12-10" },
  { account_id: "card-b", name: "Sample Card B", mask: "0002", kind: "business", balance_cents: 25000, limit_cents: 500000, used_pct: 5, due_on: "2026-11-30" }
];
const CYCLES = new Map([
  ["card-a", { bank_account_id: "card-a", statement_close_day: 16, promo_ends_on: "2027-01-05", promo_apr: 0, promo_source: "client" }],
  ["card-b", { bank_account_id: "card-b", statement_close_day: 20 }]
]);
const SNAP = {
  today: TODAY,
  asOf: NOW.toISOString(),
  overview: {
    debt: { cards: CARDS },
    accounts: [
      { id: "p-chk", type: "depository", kind: "personal" },
      { id: "b-chk", type: "depository", kind: "business" }
    ]
  },
  cycleByAccount: CYCLES,
  meta: [{ id: "p-chk", plaid_item_id: "item-1" }, { id: "b-chk", plaid_item_id: "item-2" }]
};
const report = (score, fsr) => ({ name: "Sample Cedar LLC", state: "AZ", report: { data: { scoreInformation: { commercialScore: { score }, fsrScore: { score: fsr } } } } });
const PULLS = [
  { id: "p-new", created_at: "2026-11-05T15:00:00Z", result: { environment: "production", businessReports: [report(55, 34)] } },
  { id: "p-old", created_at: "2026-10-06T15:00:00Z", result: { environment: "production", businessReports: [report(42, 30)] } }
];
const BUSINESSES = [{ id: "biz-1", name: "Sample Cedar LLC", entity_data: { state: "AZ" } }];

function fakeStore(over = {}) {
  return {
    readBundleSettings: async () => ({ card_over_10: true, business_credit: true, weekly_money: true, saved: false }),
    fundedState: async () => ({ funded: true, approvals: 1 }),
    listBusinesses: async () => BUSINESSES,
    businessPulls: async () => PULLS,
    openedBankAccounts: async () => [{ id: "r1", bank_name: "Sample Bank", opened_on: "2026-10-25", state: "done" }],
    openStepCount: async () => 3,
    weekTransactions: async () => [{ bank_account_id: "p-chk", amount_cents: 750000, posted_on: "2026-10-28", category: null }],
    bundleAlerts: async () => [],
    setBundleAlertEnabled: async (_c, a) => ({ ...a }),
    ...over
  };
}

describe("planBundleAlerts — what the daily pass sends", () => {
  test("a funded client: card A is over 10% and the business score moved — two plans, one shape", async () => {
    const r = await planBundleAlerts(null, { orgId: ORG, clientId: CLIENT, snap: SNAP, today: TODAY, now: NOW, env: {}, settings: { payment_timing: true } }, { bundleStore: fakeStore() });
    assert.deepEqual(r.plans.map((p) => p.key).sort(), ["fpa:biz:biz-1:p-new", "fpa:over10:card-a:2026-11-16"]);
    for (const p of r.plans) {
      for (const k of ["kind", "key", "templateKey", "tags", "body", "label", "detail"]) assert.ok(k in p, `${p.kind} has ${k}`);
    }
  });

  test("a switch that is off plans nothing for its kind, and says so", async () => {
    const store = fakeStore({ readBundleSettings: async () => ({ card_over_10: false, business_credit: false, weekly_money: true }) });
    const r = await planBundleAlerts(null, { orgId: ORG, clientId: CLIENT, snap: SNAP, today: TODAY, now: NOW, env: {} }, { bundleStore: store });
    assert.equal(r.plans.length, 0);
    assert.deepEqual(r.skipped.map((s) => `${s.kind}:${s.reason}`).sort(), ["business_credit:switched_off", "card_over_10:switched_off"]);
  });

  test("before funding the card rule stays quiet; the business alert still runs", async () => {
    const store = fakeStore({ fundedState: async () => ({ funded: false, approvals: 0 }) });
    const r = await planBundleAlerts(null, { orgId: ORG, clientId: CLIENT, snap: SNAP, today: TODAY, now: NOW, env: {} }, { bundleStore: store });
    assert.deepEqual(r.plans.map((p) => p.kind), ["business_credit"]);
    assert.ok(r.skipped.some((s) => s.reason === "not_funded"));
  });

  test("no saved company: no pull is read at all", async () => {
    let read = false;
    const store = fakeStore({ listBusinesses: async () => [], businessPulls: async () => { read = true; return []; } });
    await planBundleAlerts(null, { orgId: ORG, clientId: CLIENT, snap: SNAP, today: TODAY, now: NOW, env: {} }, { bundleStore: store });
    assert.equal(read, false);
  });
});

describe("alertsBundlePayload — the screen's bundle", () => {
  const payload = () => alertsBundlePayload(null, { orgId: ORG, clientId: CLIENT, now: NOW, env: {} }, {
    bundleStore: fakeStore(),
    snap: SNAP,
    readSettings: async () => ({ payment_timing: true })
  });

  test("the five pieces are there", async () => {
    const b = await payload();
    assert.deepEqual(Object.keys(b.switches), ["card_over_10", "business_credit", "weekly_money"]);
    assert.equal(b.card_rule.funded, true);
    assert.deepEqual(b.card_rule.cards.map((c) => [c.account_id, c.state]), [["card-a", "over"], ["card-b", "under"]]);
    assert.equal(b.pay_by.days_before, 2);
    assert.deepEqual(b.pay_by.cards.map((c) => [c.account_id, c.pay_by_on, c.for]), [["card-a", "2026-11-14", "statement_close"], ["card-b", "2026-11-18", "statement_close"]]);
    assert.deepEqual(b.intro.map((i) => [i.account_id, i.days_left, i.monthly_cents]), [["card-a", 60, 120000]]);
    assert.equal(b.business_credit[0].change.direction, "up");
    assert.equal(b.weekly.next_on, "2026-11-09");
    assert.match(b.weekly.preview, /^Fundhub weekly: Money came in 1 time to your personal accounts this week\./);
  });

  test("personal and business are never added: no total anywhere in the bundle", async () => {
    const b = await payload();
    const keys = [];
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      for (const [k, v] of Object.entries(o)) { keys.push(k); walk(v); }
    })(b);
    assert.ok(!keys.some((k) => /total|combined|sum/i.test(k)), keys.filter((k) => /total|combined|sum/i.test(k)).join(","));
    // Each kind holds only its own deposits.
    assert.deepEqual(b.weekly.money_in.personal, { known: true, count: 1, cents: 750000 });
    assert.deepEqual(b.weekly.money_in.business, { known: true, count: 0, cents: 0 });
  });

  test("a text already sent this cycle is marked on its card", async () => {
    const b = await alertsBundlePayload(null, { orgId: ORG, clientId: CLIENT, now: NOW, env: {} }, {
      bundleStore: fakeStore({ bundleAlerts: async () => [{ kind: "card_over_10", dedupe_key: "fpa:over10:card-a:2026-11-16", sent_at: "2026-11-05T16:00:00Z" }] }),
      snap: SNAP,
      readSettings: async () => ({ payment_timing: true })
    });
    assert.equal(b.card_rule.cards[0].texted_this_cycle, true);
    assert.equal(b.card_rule.cards[1].texted_this_cycle, false);
  });

  test("a client not in the org is null (the endpoint answers 404)", async () => {
    const r = await alertsBundlePayload(null, { orgId: ORG, clientId: CLIENT, now: NOW }, {
      bundleStore: fakeStore(), loadSnapshot: async () => null, readSettings: async () => ({})
    });
    assert.equal(r, null);
  });
});

test("loadWeeklyFacts: the job and the screen read the same week", async () => {
  const f = await loadWeeklyFacts(null, { orgId: ORG, clientId: CLIENT, snap: SNAP, now: new Date("2026-11-09T16:00:00Z") }, {
    bundleStore: fakeStore({ weekTransactions: async () => [{ bank_account_id: "b-chk", amount_cents: 1000, posted_on: "2026-11-04", category: null }] })
  });
  assert.equal(f.week.monday, "2026-11-09");
  assert.equal(f.moneyIn.business.count, 1);
  assert.equal(f.openSteps, 3);
});

describe("setBundleAlert — the POST", () => {
  test("a known kind and a true/false switch is saved", async () => {
    let saw = null;
    const store = fakeStore({ setBundleAlertEnabled: async (_c, a) => { saw = a; } });
    const r = await setBundleAlert(null, { orgId: ORG, clientId: CLIENT, body: { kind: "weekly_money", enabled: false }, by: "client" }, { bundleStore: store });
    assert.deepEqual(r, { kind: "weekly_money", enabled: false });
    assert.equal(saw.kind, "weekly_money");
    assert.equal(saw.by, "client");
  });

  test("anything else is the endpoint's own 400", async () => {
    await assert.rejects(setBundleAlert(null, { orgId: ORG, clientId: CLIENT, body: { kind: "promo_end", enabled: true } }, { bundleStore: fakeStore() }), FileAlertInputError);
    await assert.rejects(setBundleAlert(null, { orgId: ORG, clientId: CLIENT, body: { kind: "weekly_money", enabled: 1 } }, { bundleStore: fakeStore() }), FileAlertInputError);
  });
});
