// "Your funding paths" — src/finance/funding-paths.mjs. The pure parts on plain
// payloads; the read on a fake database that records every statement. No
// Postgres, no network, no press.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  estimateOf, selfPath, agreedPercent, othersPath, fundhubPath, doneForYouDeposit, fundingPaths, paysOn, paysOnce,
  STEPS_URL, PAYMENTS_URL, PARTNER_URL, AFFILIATE_URL, CURRENT_ENGINE
} from "./funding-paths.mjs";
import { OFFERS } from "../config/offers.mjs";
import { BOOK_CALL_URL } from "../deliverables/chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = JSON.parse(fs.readFileSync(path.join(HERE, "../http/fixtures/money-fundability.sample.json"), "utf8"));
const sample = () => JSON.parse(JSON.stringify(SAMPLE));
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const AFF = "af000000-0000-4000-8000-000000000001";
const ENV = { PUBLIC_BASE_URL: "https://fundhub.ai" };

describe("estimateOf — the UnderwriteIQ figure the Fundability tab already shows", () => {
  test("the lite engine: today's estimate and the last 'on your plan' point", () => {
    const e = estimateOf(sample());
    assert.deepEqual(e, { today_cents: 21200000, plan_cents: 21200000, plan_months: 12, source: "underwrite_iq_lite" });
  });

  test("the current CRS engine wins when it answers for the personal file", () => {
    const d = sample();
    d.opportunity = { basis: CURRENT_ENGINE, personal: { status: "modeled", currentCents: 9360000, projectedCents: 10400000, blockers: [] } };
    assert.deepEqual(estimateOf(d), { today_cents: 9360000, plan_cents: 10400000, plan_months: null, source: CURRENT_ENGINE });
  });

  test("an unsafe current figure stays unknown — the lite number never fills the gap", () => {
    const d = sample();
    d.opportunity = { basis: CURRENT_ENGINE, personal: { status: "unknown", currentCents: null, projectedCents: null,
      blockers: ["current_engine_does_not_expose_safe_capacity"] } };
    const e = estimateOf(d);
    assert.equal(e.today_cents, null, "the $212,000 lite figure must not be shown");
    assert.equal(e.plan_cents, null);
    assert.equal(e.source, CURRENT_ENGINE);
  });

  test("not fundable: no dollar figure, null not 0", () => {
    const d = sample();
    d.now.funding_estimate_cents = null;
    d.projections = d.projections.map((p) => ({ ...p, funding_estimate_cents: null }));
    const e = estimateOf(d);
    assert.equal(e.today_cents, null);
    assert.equal(e.plan_cents, null);
    assert.equal(e.plan_months, null);
    assert.deepEqual(estimateOf(null), { today_cents: null, plan_cents: null, plan_months: null, source: "underwrite_iq_lite" });
  });
});

describe("selfPath — fund it yourself", () => {
  test("the checks, the estimate and the client's own next step", () => {
    const s = selfPath(sample(), { title: "Pay Card A down to $800", due_at: new Date("2026-11-20T07:00:00Z") });
    assert.equal(s.ok, true);
    assert.equal(s.has_pull, true);
    assert.equal(s.tier, "fundable");
    assert.equal(s.checks_passed, 5);
    assert.equal(s.checks_of, 6);
    assert.equal(s.today_cents, 21200000);
    assert.deepEqual(s.next_step, { title: "Pay Card A down to $800", due_on: "2026-11-20" });
    assert.equal(s.steps_url, STEPS_URL);
  });

  test("no pull: nothing to count, nothing made up", () => {
    const s = selfPath({ ok: true, has_pull: false, now: { score: null, score_max: 6, tier: null, funding_estimate_cents: null }, projections: [] }, null);
    assert.equal(s.has_pull, false);
    assert.equal(s.checks_passed, null);
    assert.equal(s.today_cents, null);
    assert.equal(s.tier, null);
    assert.equal(s.next_step, null);
  });
});

describe("agreedPercent — one number only when every live rule agrees", () => {
  test("all twenty: 20", () => {
    assert.equal(agreedPercent([{ tier: "direct", calc_method: "percent", percent: "20.00" }, { tier: "direct", calc_method: "percent", percent: 20 }], "direct"), 20);
  });
  test("a disagreement, a flat rule, or no rule: null", () => {
    assert.equal(agreedPercent([{ tier: "direct", calc_method: "percent", percent: 20 }, { tier: "direct", calc_method: "percent", percent: 15 }], "direct"), null);
    assert.equal(agreedPercent([{ tier: "direct", calc_method: "flat", percent: null }], "direct"), null);
    assert.equal(agreedPercent([{ tier: "downline", calc_method: "percent", percent: 5 }], "direct"), null);
    assert.equal(agreedPercent([], "direct"), null);
  });
});

describe("othersPath — fund other people", () => {
  const RULES = [
    { tier: "direct", calc_method: "percent", percent: "20" },
    { tier: "direct", calc_method: "percent", percent: "20" },
    { tier: "downline", calc_method: "percent", percent: "5" }
  ];
  test("a client who has not joined: the rate they would earn, no link, no counts", () => {
    const o = othersPath({ affiliate: null, counts: null, rules: RULES, env: ENV });
    assert.equal(o.affiliate.enrolled, false);
    assert.equal(o.affiliate.share_url, null);
    assert.equal(o.affiliate.sent, null);
    assert.equal(o.affiliate.direct_pct, 20);
    assert.equal(o.affiliate.downline_pct, 5);
    assert.equal(o.affiliate.dashboard_url, AFFILIATE_URL);
  });
  test("a client who joined: their own link and their own numbers", () => {
    const o = othersPath({ affiliate: { id: AFF, tracking_id: "AFF-000123" }, counts: { sent: 3, signed_up: 1 }, rules: RULES, env: ENV });
    assert.equal(o.affiliate.enrolled, true);
    assert.match(o.affiliate.share_url, /AFF-000123/);
    assert.equal(o.affiliate.sent, 3);
    assert.equal(o.affiliate.signed_up, 1);
  });
  test("white-label prices come from the catalog, never typed here", () => {
    const o = othersPath({});
    assert.equal(o.white_label.entry_cents, OFFERS.PARTNER_ENTRY.priceCents);
    assert.equal(o.white_label.trial_cents, OFFERS.LIVE_TRIAL.priceCents);
    assert.equal(o.white_label.name, OFFERS.PARTNER_ENTRY.name);
    assert.equal(o.white_label.url, PARTNER_URL);
  });
  test("owner-set 2026-11-07: white label is $30,000; the 7-day trial stays $297", () => {
    assert.equal(OFFERS.PARTNER_ENTRY.priceCents, 3000000);
    assert.equal(othersPath({}).white_label.entry_cents, 3000000);
    assert.equal(othersPath({}).white_label.trial_cents, 29700);
  });
});

/* The live referral rules (db/migrations 261, 272, 399). */
const live = (tier, pct) => [
  ["card-stacking-dfy", "partner_share_of_cash"], ["repair-bundle", "sale_price"],
  ["consulting-package", "sale_price"], ["diagnostic", "sale_price"]
].map(([product_code, amount_basis]) => ({ tier, calc_method: "percent", percent: String(pct), amount_basis, scope_rule: "first_paid_product", product_code }));
const LIVE = [...live("direct", 20), ...live("downline", 5)];

describe("paysOn / paysOnce — what a referral pays on, from the live rules (Codex CX20)", () => {
  test("each sale the rules pay on, what the percent is of, and when it counts", () => {
    assert.deepEqual(paysOn(LIVE, "direct"), [
      { sale: "Done-for-you funding", of: "what they pay", when: "after they get funded" },
      { sale: "Credit repair", of: "the price", when: null },
      { sale: "Capital Blueprint", of: "the price", when: null },
      { sale: "The roadmap", of: "the price", when: null }
    ]);
    assert.equal(paysOnce(LIVE, "direct"), true, "once per person, on the first of these they buy");
  });

  test("the same sale twice (an affiliate's own rule beside the org's) is one line", () => {
    const rules = [...live("direct", 20), { ...live("direct", 20)[1] }];
    assert.equal(paysOn(rules, "direct").length, 4);
  });

  test("a sale or basis that cannot be said, or no rule at all: null, so the card shows no percent", () => {
    assert.equal(paysOn([...LIVE, { ...LIVE[0], product_code: "mystery-product" }], "direct"), null);
    assert.equal(paysOn([...LIVE, { ...LIVE[0], product_code: null }], "direct"), null, "a rule for every product names no sale");
    assert.equal(paysOn([...LIVE, { ...LIVE[0], amount_basis: "something_new" }], "direct"), null);
    assert.equal(paysOn([], "direct"), null);
    assert.equal(paysOn(LIVE, "nobody"), null);
  });

  test("paysOnce: every sale is false, a mix or nothing is null", () => {
    assert.equal(paysOnce(LIVE.map((r) => ({ ...r, scope_rule: "every_sale" })), "direct"), false);
    assert.equal(paysOnce([...LIVE, { ...LIVE[0], scope_rule: "every_sale" }], "direct"), null);
    assert.equal(paysOnce([], "direct"), null);
  });

  test("othersPath carries them for the card", () => {
    const o = othersPath({ rules: LIVE, env: ENV });
    assert.equal(o.affiliate.direct_pct, 20);
    assert.equal(o.affiliate.pays_on.length, 4);
    assert.equal(o.affiliate.pays_once, true);
    const bare = othersPath({ rules: [{ tier: "direct", calc_method: "percent", percent: "20" }], env: ENV });
    assert.equal(bare.affiliate.direct_pct, 20);
    assert.equal(bare.affiliate.pays_on, null, "a rule with no sale cannot be said");
  });
});

describe("fundhubPath — Fundhub funds you", () => {
  const NOT_OWNED = { blueprint: { owned: false, name: "Capital Blueprint", sell: { how: "call", url: BOOK_CALL_URL } } };
  const OWNED = { blueprint: { owned: true, name: "Capital Blueprint", sell: null } };

  test("done for you is the catalog's own deposit and success fee", () => {
    const f = fundhubPath({ products: NOT_OWNED });
    assert.equal(f.done_for_you.deposit_cents, OFFERS.FUNDING_DFY.priceCents);
    assert.equal(f.done_for_you.success_fee_pct, OFFERS.FUNDING_DFY.successFeePercent);
    assert.equal(f.done_for_you.name, OFFERS.FUNDING_DFY.name);
    assert.equal(f.ready, null, "an unread request is unknown, not 'none'");
  });

  test("owner-set 2026-11-07: the $3,000 deposit is waived for a Blueprint owner, from the catalog", () => {
    assert.equal(OFFERS.FUNDING_DFY.priceCents, 300000);
    assert.equal(OFFERS.FUNDING_DFY.blueprintOwnerDepositCents, 0);
    assert.equal(OFFERS.FUNDING_DFY.successFeePercent, 10);
  });

  test("a Blueprint owner: $0 to start, the $3,000 waived, the same 10%", () => {
    const d = fundhubPath({ products: OWNED }).done_for_you;
    assert.deepEqual(d, { name: OFFERS.FUNDING_DFY.name, deposit_cents: 0, deposit_waived: true, standard_deposit_cents: 300000, success_fee_pct: 10 });
  });

  test("not a Blueprint owner: $3,000 to start, nothing waived, the same 10%", () => {
    const d = fundhubPath({ products: NOT_OWNED }).done_for_you;
    assert.deepEqual(d, { name: OFFERS.FUNDING_DFY.name, deposit_cents: 300000, deposit_waived: false, standard_deposit_cents: 300000, success_fee_pct: 10 });
  });

  test("ownership unknown (its read failed): the deposit is unknown, never $0 and never $3,000", () => {
    for (const f of [fundhubPath({}), fundhubPath({ products: null })]) {
      assert.equal(f.done_for_you.deposit_cents, null);
      assert.equal(f.done_for_you.deposit_waived, null);
      assert.equal(f.done_for_you.success_fee_pct, 10, "the fee does not depend on the Blueprint");
    }
    assert.deepEqual(doneForYouDeposit(undefined), { deposit_cents: null, deposit_waived: null, standard_deposit_cents: 300000 });
    assert.deepEqual(doneForYouDeposit(true), { deposit_cents: 0, deposit_waived: true, standard_deposit_cents: 300000 });
    assert.deepEqual(doneForYouDeposit(false), { deposit_cents: 300000, deposit_waived: false, standard_deposit_cents: 300000 });
  });

  test("not a Capital Blueprint buyer: ClarityPay on the Blueprint, booked on a call", () => {
    const f = fundhubPath({
      ready: { status: "none", requested_at: null, done_at: null },
      products: { blueprint: { owned: false, name: "Capital Blueprint", sell: { how: "call", url: BOOK_CALL_URL } } },
      plans: []
    });
    assert.equal(f.ready.status, "none");
    assert.equal(f.financing.provider, "ClarityPay");
    assert.equal(f.financing.offer, OFFERS.UWIQ_DELIVERABLES.name);
    assert.equal(f.financing.blueprint_owned, false);
    assert.equal(f.financing.book_url, BOOK_CALL_URL);
    assert.equal(f.financing.plans_open, 0);
    assert.equal(f.financing.left_cents, null);
  });

  test("open payment plans: what is left on them, and null when one is unknown", () => {
    const owned = { blueprint: { owned: true, sell: null } };
    const f = fundhubPath({ products: owned, plans: [
      { status: "open", left_cents: 120000 }, { status: "open", left_cents: 30000 }, { status: "settled", left_cents: 0 }
    ] });
    assert.equal(f.financing.plans_open, 2);
    assert.equal(f.financing.left_cents, 150000);
    assert.equal(f.financing.book_url, null);
    assert.equal(f.financing.payments_url, PAYMENTS_URL);
    const g = fundhubPath({ products: owned, plans: [{ status: "open", left_cents: 120000 }, { status: "open", left_cents: null }] });
    assert.equal(g.financing.left_cents, null, "never a partial sum");
  });
});

/* ── the read ─────────────────────────────────────────────────────────── */

function fakeDb({ affiliate = null, counts = { sent: 0, signed_up: 0 }, rules = [], fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail && fail.test(sql)) throw new Error("boom");
      if (/FROM accounts acc/.test(sql)) return { rows: affiliate ? [affiliate] : [] };
      if (/FROM affiliate_referrals/.test(sql)) return { rows: [counts] };
      if (/FROM affiliate_commission_rules/.test(sql)) return { rows: rules };
      return { rows: [] };
    }
  };
}
const DEPS = {
  readOpenWaypoints: async () => [{ title: "Pay Card A down to $800", due_at: "2026-11-20" }],
  readyToFundStatus: async () => ({ status: "requested", round: 1, requested_at: "2026-11-06T18:00:00.000Z", done_at: null }),
  productOffers: async () => ({ blueprint: { owned: false, sell: { how: "call", url: BOOK_CALL_URL } } }),
  listClarityPayments: async () => []
};

describe("fundingPaths — the three paths from the client's own rows", () => {
  test("all three answer; the affiliate reads are bound to the org and the client", async () => {
    const db = fakeDb({ affiliate: { id: AFF, tracking_id: "AFF-000123" }, counts: { sent: 2, signed_up: 1 },
      rules: [{ tier: "direct", calc_method: "percent", percent: "20" }] });
    const r = await fundingPaths(db, { orgId: ORG, clientId: CLIENT, fundability: sample(), asOf: new Date("2026-11-07T12:00:00Z"), viewer: "client", env: ENV, deps: DEPS });
    assert.equal(r.ok, true);
    assert.equal(r.viewer, "client");
    assert.equal(r.self.today_cents, 21200000);
    assert.equal(r.self.next_step.title, "Pay Card A down to $800");
    assert.equal(r.others.affiliate.enrolled, true);
    assert.equal(r.others.affiliate.sent, 2);
    assert.equal(r.others.affiliate.direct_pct, 20);
    assert.equal(r.fundhub.ready.status, "requested");
    const acct = db.calls.find((c) => /FROM accounts acc/.test(c.sql));
    assert.deepEqual(acct.params, [ORG, CLIENT]);
    const counts = db.calls.find((c) => /FROM affiliate_referrals/.test(c.sql));
    assert.deepEqual(counts.params, [ORG, AFF]);
    const rules = db.calls.find((c) => /FROM affiliate_commission_rules/.test(c.sql));
    assert.deepEqual(rules.params, [ORG, AFF]);
    // Each rule's sale and basis come with it, the product read inside the org.
    assert.match(rules.sql, /r\.amount_basis, r\.scope_rule, p\.code AS product_code/);
    assert.match(rules.sql, /LEFT JOIN products p ON p\.id = r\.product_id AND p\.org_id = r\.org_id/);
  });

  test("not joined: no counts read, and the rules are the org's own", async () => {
    const db = fakeDb();
    const r = await fundingPaths(db, { orgId: ORG, clientId: CLIENT, fundability: sample(), env: ENV, deps: DEPS });
    assert.equal(r.others.affiliate.enrolled, false);
    assert.equal(db.calls.some((c) => /FROM affiliate_referrals/.test(c.sql)), false);
    const rules = db.calls.find((c) => /FROM affiliate_commission_rules/.test(c.sql));
    assert.deepEqual(rules.params, [ORG, null]);
  });

  test("one path's read failing leaves the other two standing", async () => {
    const r = await fundingPaths(fakeDb({ fail: /FROM accounts acc/ }), { orgId: ORG, clientId: CLIENT, fundability: sample(), env: ENV, deps: DEPS });
    assert.deepEqual(r.others, { ok: false });
    assert.equal(r.self.ok, true);
    assert.equal(r.fundhub.ok, true);
    const s = await fundingPaths(fakeDb(), { orgId: ORG, clientId: CLIENT, fundability: sample(), env: ENV,
      deps: { ...DEPS, readOpenWaypoints: async () => { throw new Error("down"); } } });
    assert.deepEqual(s.self, { ok: false });
    assert.equal(s.others.ok, true);
  });

  test("a failed ready-to-fund read is unknown, not 'none'", async () => {
    const r = await fundingPaths(fakeDb(), { orgId: ORG, clientId: CLIENT, fundability: sample(), env: ENV,
      deps: { ...DEPS, readyToFundStatus: async () => { throw new Error("down"); } } });
    assert.equal(r.fundhub.ok, true);
    assert.equal(r.fundhub.ready, null);
  });

  test("the deposit follows the client's own Blueprint read: owner $0, not an owner $3,000, a failed read unknown", async () => {
    const seen = [];
    const owner = await fundingPaths(fakeDb(), { orgId: ORG, clientId: CLIENT, fundability: sample(), env: ENV,
      deps: { ...DEPS, productOffers: async (_db, args) => { seen.push(args); return { blueprint: { owned: true, sell: null } }; } } });
    assert.equal(owner.fundhub.done_for_you.deposit_cents, 0);
    assert.equal(owner.fundhub.done_for_you.deposit_waived, true);
    assert.equal(owner.fundhub.done_for_you.success_fee_pct, 10);
    assert.equal(seen[0].orgId, ORG);
    assert.equal(seen[0].clientId, CLIENT);
    const other = await fundingPaths(fakeDb(), { orgId: ORG, clientId: CLIENT, fundability: sample(), env: ENV, deps: DEPS });
    assert.equal(other.fundhub.done_for_you.deposit_cents, 300000);
    assert.equal(other.fundhub.done_for_you.deposit_waived, false);
    const down = await fundingPaths(fakeDb(), { orgId: ORG, clientId: CLIENT, fundability: sample(), env: ENV,
      deps: { ...DEPS, productOffers: async () => { throw new Error("down"); } } });
    assert.equal(down.fundhub.ok, true);
    assert.equal(down.fundhub.done_for_you.deposit_cents, null);
    assert.equal(down.fundhub.done_for_you.deposit_waived, null);
  });

  test("the viewer is only client or staff; anything else reads as the client", async () => {
    const r = await fundingPaths(fakeDb(), { orgId: ORG, clientId: CLIENT, fundability: sample(), viewer: "owner", env: ENV, deps: DEPS });
    assert.equal(r.viewer, "client");
    const s = await fundingPaths(fakeDb(), { orgId: ORG, clientId: CLIENT, fundability: sample(), viewer: "staff", env: ENV, deps: DEPS });
    assert.equal(s.viewer, "staff");
  });

  test("org and client are required", async () => {
    await assert.rejects(() => fundingPaths(fakeDb(), { orgId: ORG }), /orgId and clientId/);
  });
});
