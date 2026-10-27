import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFERS, formatCents } from "../config/offers.mjs";
import { mergeBureauReports } from "../finance/crs-map.mjs";
import { makeFakeDb } from "../documents/fake-db.mjs";
import { createStore, memoryProvider } from "../documents/store.mjs";
import {
  buildCloserDeck,
  selectedOfferKey,
  generateDeckLetters,
  sendDeckPayLink,
  logDeckDisposition,
  sendDeckSoftPull,
  freshSoftPullSkip,
  SOFT_PULL_REUSE_DAYS,
  CloserDeckError
} from "./closer-deck.mjs";
import { SLO_POST_PURCHASE_ENABLED } from "../slo/purchase.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";
const ENV_ON = { [SLO_POST_PURCHASE_ENABLED]: "true" };

test("Present links cash only from its exact paid checkout link", async () => {
  const STAFF = "33333333-3333-4333-8333-333333333333";
  const LINK = "44444444-4444-4444-8444-444444444444";
  const seen = [];
  const db = { query: async (sql, params) => {
    seen.push({ sql: String(sql), params });
    if (/FROM payment_links pl/.test(sql)) return { rows: [{ id: "tx-paid" }] };
    if (/SELECT id, custom_fields FROM clients/.test(sql)) return { rows: [{ id: CID, custom_fields: {} }] };
    if (/FROM transactions/.test(sql)) return { rows: [{ id: "tx-paid", amount_paid: "3000.00" }] };
    if (/INSERT INTO call_outcomes/.test(sql)) return { rows: [{ id: "call-1", org_id: ORG, client_id: CID, staff_id: STAFF, outcome: "deposit", cash_collected_cents: params[7], transaction_id: params[8] }] };
    if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-1" }] };
    return { rows: [] };
  } };
  const result = await logDeckDisposition(db, { orgId: ORG, clientId: CID, staffId: STAFF, offerKey: "FUNDING_DFY", paymentLinkId: LINK });
  assert.equal(result.row.cash_collected_cents, 300000);
  assert.equal(result.row.transaction_id, "tx-paid");
  const lookup = seen.find((call) => /FROM payment_links pl/.test(call.sql));
  assert.deepEqual(lookup.params, [LINK, ORG, CID, STAFF, "card-stacking-dfy"]);
  assert.match(lookup.sql, /sp.payment_link_id = pl.id/);
  assert.match(lookup.sql, /sp.amount > 0/);
});

function fakeDb({
  client = null,
  crs = null,
  businesses = [],
  tradelines = [],
  liabilities = []
} = {}) {
  return {
    async query(sql) {
      const s = String(sql);
      if (/FROM clients c/i.test(s)) {
        return { rows: client ? [client] : [] };
      }
      if (/FROM crs_results/i.test(s)) {
        return { rows: crs ? [crs] : [] };
      }
      if (/FROM businesses/i.test(s)) {
        return { rows: businesses };
      }
      if (/FROM tradelines/i.test(s)) {
        return { rows: tradelines };
      }
      if (/FROM card_liabilities/i.test(s)) {
        return { rows: liabilities };
      }
      if (/FROM payment_links/i.test(s)) return { rows: [] };
      if (/FROM soft_pull_requests/i.test(s)) return { rows: [] };
      if (/FROM client_consents/i.test(s)) return { rows: [] };
      throw new Error("unexpected sql: " + s.slice(0, 80));
    }
  };
}

const CLIENT = {
  id: CID,
  first_name: "Marcus",
  last_name: "Webb",
  email: "m@example.com",
  phone: "555",
  outcome_tier: "REPAIR_ONLY",
  custom_fields: {
    cf_svy_funding_target_amount: "$100k - $200k",
    cf_svy_planned_use: "Equipment or buildout",
    cf_svy_has_business: "Yes, 2-5 years",
    cf_svy_business_revenue: "$250k - $499k",
    cf_svy_annual_income_range: "$100k-$199k",
    cf_svy_available_capital: "$5k - $25k",
    cf_svy_money_change_now: "Grow faster (more customers / more reach)"
  },
  business_name: "Webb Contracting LLC"
};

test("missing client is null, not invented people", async () => {
  const out = await buildCloserDeck(fakeDb(), { orgId: ORG, clientId: CID });
  assert.equal(out, null);
});

test("no CRS row is a labeled unavailable engine, survey still fills", async () => {
  const out = await buildCloserDeck(fakeDb({ client: CLIENT }), { orgId: ORG, clientId: CID });
  assert.equal(out.survey.name, "Marcus Webb");
  assert.equal(out.survey.entity, "Webb Contracting LLC");
  assert.equal(out.survey.target, "$100k - $200k");
  assert.equal(out.engine.available, false);
  assert.equal(out.engine.reason, "engine data unavailable");
  assert.equal(out.engine.fico.ex, null);
  assert.equal(out.engine.total, null);
  assert.deepEqual(out.income_estimates, { experian: null, equifax: null, asOf: null });
  assert.equal(out.offers.length, Object.keys(OFFERS).length);
});

test("stored closer payload maps FICO, total, reasons — no invented numbers", async () => {
  const crs = {
    outcome_tier: "FUNDING_PLUS_REPAIR",
    created_at: "2026-08-16T00:00:00Z",
    result: {
      environment: "production",
      outcome: "FUNDING_PLUS_REPAIR",
      reasonCodes: [
        ["M2-013 · TU", "TransUnion tradeline reports paid, zero balance, while showing a balance owed"]
      ],
      preapprovals: { totalCombined: 127500 },
      projectedPreapproval: { totalCombined: 214000 },
      scores: { perBureau: { ex: 712, tu: 648, eq: 641 } },
      bureauNegatives: { tu: { count: 3 }, eq: { count: 2 }, ex: { count: 0 } },
      bureaus: {
        EX: { scores: [
          { modelName: "Experian/Fair Isaac Risk Model V9", scoreValue: "712" },
          { modelName: "Income Insight", scoreValue: "97" }
        ]},
        EQ: { scores: [
          { modelName: "Consumer IncomeView+ Model", scoreValue: "81", scoreMaximumValue: "300" },
          { modelName: "FICO Score 9", scoreValue: "641" }
        ]}
      }
    }
  };
  const out = await buildCloserDeck(fakeDb({ client: { ...CLIENT, outcome_tier: "FUNDING_PLUS_REPAIR" }, crs }), {
    orgId: ORG, clientId: CID
  });
  assert.equal(out.engine.available, true);
  assert.equal(out.engine.tier, "FUNDING_PLUS_REPAIR");
  assert.equal(out.engine.fico.ex, 712);
  assert.equal(out.engine.fico.tu, 648);
  assert.equal(out.engine.afterFix, 214000);
  /* F15, owner-set 2026-09-03. This used to assert the opposite — that the
     headline was a fresh UnderwriteIQ stack computed here at render time, "not
     the canned CRS 127500". That recompute is what put $939,500 on a customer's
     pre-approval slide while the engine had stored $199,350 and the client's own
     portal was showing $199,350. The deck quotes the stored figure now, and
     performs no funding arithmetic of its own. */
  assert.equal(out.engine.total, 127500);
  assert.equal(out.engine.totalSource, "stored engine estimate");
  assert.equal(out.engine.totalBasis, "personal_only", "no company on this file");
  assert.equal(out.engine.negItems, 5);
  assert.equal(out.engine.reasons[0][0], "M2-013 · TU");
  assert.equal(out.income_estimates.experian.annual, 97000);
  assert.equal(out.income_estimates.equifax.annual, 81000);
});

/* F15, owner-set 2026-09-03: ONE stored number, no second calculation.
   This test previously required the opposite — that adding a company row raised
   the figure on the deck, because the deck re-ran the stack while it drew the
   screen. A figure that should move when a company is added moves when the
   engine runs again and STORES a new estimate. A sales screen never does its
   own arithmetic on a number it reads out to a customer. */
test("adding a company does not move the deck's figure — the stored estimate is the figure", async () => {
  const crs = {
    outcome_tier: "FULL_FUNDING",
    created_at: "2026-08-16T00:00:00Z",
    result: {
      environment: "production",
      outcome: "FULL_FUNDING",
      preapprovals: { totalPersonal: 100000, totalBusiness: 50000, totalCombined: 150000 },
      scores: { perBureau: { ex: 720, tu: 710, eq: 705 }, ex: 720, tu: 710, eq: 705 }
    }
  };
  const client = {
    ...CLIENT,
    outcome_tier: "FULL_FUNDING",
    custom_fields: {
      ...CLIENT.custom_fields,
      crs_inquiries_ex: 0,
      crs_inquiries_eq: 0,
      crs_inquiries_tu: 0,
      crs_negative_items_count: 0,
      crs_late_payments_count: 0
    }
  };
  const tradelines = [{
    id: "tl1",
    lender: "Chase",
    kind: "revolving",
    credit_limit_cents: 2_000_000,
    balance_cents: 400_000,
    apr: "0.1899",
    closed_at: null,
    opened_on: "2018-01-01"
  }];
  const one = await buildCloserDeck(fakeDb({
    client,
    crs,
    tradelines,
    businesses: [{ age_months: 30 }]
  }), { orgId: ORG, clientId: CID });
  const two = await buildCloserDeck(fakeDb({
    client,
    crs,
    tradelines,
    businesses: [{ age_months: 30 }, { age_months: 30 }]
  }), { orgId: ORG, clientId: CID });
  assert.equal(one.engine.total, 150000, "the stored preapprovals.totalCombined");
  assert.equal(two.engine.total, one.engine.total);
  /* The label still moves, because whether business money is in the stored
     figure is a real difference the closer and the client must be able to see. */
  assert.equal(one.engine.totalBasis, "personal_plus_business");
  assert.equal(two.engine.totalBasis, "personal_plus_business");
});

/* Deck and portal quote ONE number. Chris, after the 2026-09-03 walk: "fix the
   deck to the portal, not the reverse." They call the same reader, so they
   cannot drift apart again. */
test("the deck's figure is the client portal's figure", async () => {
  const { prequalFromCustomFields } = await import("../http/portal-prequal.mjs");
  const custom = { ...CLIENT.custom_fields, total_funding_estimate: 199350 };
  const crs = {
    outcome_tier: "FULL_FUNDING",
    created_at: "2026-08-16T00:00:00Z",
    result: {
      environment: "production",
      outcome: "FULL_FUNDING",
      preapprovals: { totalCombined: 199350 },
      scores: { perBureau: { ex: 762, tu: 758, eq: 770 } }
    }
  };
  const out = await buildCloserDeck(fakeDb({
    client: { ...CLIENT, outcome_tier: "FULL_FUNDING", custom_fields: custom },
    crs
  }), { orgId: ORG, clientId: CID });
  assert.equal(out.engine.total, prequalFromCustomFields(custom));
  assert.equal(out.engine.total, 199350);
  assert.equal(out.engine.totalBasis, "personal_only");
});

test("empty CRS object is unavailable, not zeros", async () => {
  const out = await buildCloserDeck(fakeDb({ client: CLIENT, crs: { result: {}, outcome_tier: null } }), {
    orgId: ORG, clientId: CID
  });
  assert.equal(out.engine.available, false);
  assert.equal(out.engine.fico.ex, null);
  assert.equal(out.engine.total, null);
});

/* F11 — the deck printed 207883 where the client's own words belong, on the
   slide headed "This is what you told us" and again as the biggest number on
   the goal slide. ClickFunnels puts the answer-option ROW ID on cf_svy_<key>
   and the words on cf_svy_<key>_label. */
test("survey answers resolve to the client's words, never the option id", async () => {
  const out = await buildCloserDeck(fakeDb({
    client: {
      ...CLIENT,
      custom_fields: {
        cf_svy_funding_target_amount: "207883",
        cf_svy_funding_target_amount_label: "$200k - $400k",
        cf_svy_planned_use: 207888,
        cf_svy_planned_use_label: "Growth (marketing, inventory, hiring)",
        cf_svy_has_business: "207918",
        cf_svy_has_business_labels: ["Yes, 5+ years"],
        // No label stored at all: a dash beats a database row id on a slide a
        // customer is reading over a screen share.
        cf_svy_business_revenue: "208124",
        cf_svy_available_capital: "$100k+"
      }
    }
  }), { orgId: ORG, clientId: CID });

  assert.equal(out.survey.target, "$200k - $400k");
  assert.equal(out.survey.use, "Growth (marketing, inventory, hiring)");
  assert.equal(out.survey.hasBiz, "Yes, 5+ years");
  assert.equal(out.survey.revenue, null, "a bare option id must not reach the slide");
  assert.equal(out.survey.capital, "$100k+", "a real answer must survive untouched");
});

/* F16 — the panel read "pull: not started" and "tier: FULL_FUNDING" at the same
   time, beside a full set of scores. Two records, one fact, and only one of
   them was being asked. */
test("a stored credit result is a finished pull, whatever the request row says", async () => {
  const db = {
    async query(sql) {
      const s = String(sql);
      if (/FROM clients c/i.test(s)) return { rows: [CLIENT] };
      if (/FROM crs_results/i.test(s)) {
        return { rows: [{ id: "crs-1", outcome_tier: "FULL_FUNDING", created_at: "2026-09-03T00:00:00Z", result: {} }] };
      }
      if (/FROM businesses/i.test(s)) return { rows: [] };
      if (/FROM payment_links/i.test(s)) return { rows: [] };
      if (/FROM soft_pull_requests/i.test(s)) return { rows: [] };
      if (/FROM client_consents/i.test(s)) return { rows: [] };
      throw new Error("unexpected sql: " + s.slice(0, 80));
    }
  };
  const out = await buildCloserDeck(db, { orgId: ORG, clientId: CID });
  assert.equal(out.soft_pull.pull_status, "complete");
  assert.equal(out.soft_pull.pull_status_source, "crs_result");
  assert.equal(out.soft_pull.outcome_tier, "FULL_FUNDING");
  assert.equal(out.soft_pull.last_pull_at, "2026-09-03T00:00:00Z");
  assert.equal(out.last_pull_at, "2026-09-03T00:00:00Z");
  assert.equal(out.slo_ref, null);
  assert.equal(out.slo_pack_status, null);
});

test("a sample result does not complete the soft pull or set a real pull time", async () => {
  const crs = { id: "sample-1", outcome_tier: "FUNDING_PLUS_REPAIR", created_at: "2026-10-26T00:00:00Z",
    result: { simulated: true, environment: "simulated" }, is_demo: true };
  const out = await buildCloserDeck(fakeDb({ client: CLIENT, crs }), { orgId: ORG, clientId: CID });
  assert.equal(out.engine.sample, true);
  assert.equal(out.soft_pull.sample, true);
  assert.equal(out.soft_pull.pull_status, "sample only");
  assert.equal(out.soft_pull.pull_status_source, "sample_result");
  assert.equal(out.soft_pull.last_pull_at, null);
  assert.equal(out.last_pull_at, null);
});

test("deck JSON includes stored slo_ref and pack status without inventing them", async () => {
  const client = {
    ...CLIENT,
    custom_fields: {
      ...CLIENT.custom_fields,
      slo_ref: "clickfunnels:order:evt-slo-1:cf-prod-slo-1",
      slo_source: "slo",
      slo_pack_status: "Delivered"
    }
  };
  const out = await buildCloserDeck(fakeDb({ client }), { orgId: ORG, clientId: CID });
  assert.equal(out.slo_ref, "clickfunnels:order:evt-slo-1:cf-prod-slo-1");
  assert.equal(out.slo_source, "slo");
  assert.equal(out.slo_pack_status, "Delivered");
  assert.equal(out.last_pull_at, null);
});

test("freshSoftPullSkip: younger than 30 days is a skip; 30 days or older is not", () => {
  const now = new Date("2026-09-20T00:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  assert.equal(SOFT_PULL_REUSE_DAYS, 30);
  assert.equal(freshSoftPullSkip(null, now), null);
  assert.equal(freshSoftPullSkip({ created_at: null }, now), null);
  assert.equal(freshSoftPullSkip({ created_at: now.toISOString(), result: { simulated: true } }, now), null);
  assert.equal(freshSoftPullSkip({ created_at: now.toISOString(), is_demo: true }, now), null);
  const fresh = freshSoftPullSkip({
    id: "crs-fresh",
    created_at: new Date(now.getTime() - 5 * day).toISOString()
  }, now);
  assert.equal(fresh.skipped, true);
  assert.equal(fresh.reason, "fresh_pull_on_file");
  assert.equal(fresh.crs_result_id, "crs-fresh");
  assert.equal(fresh.pull_age_days, 5);
  assert.equal(freshSoftPullSkip({
    id: "crs-edge",
    created_at: new Date(now.getTime() - 30 * day).toISOString()
  }, now), null);
  assert.equal(freshSoftPullSkip({
    id: "crs-stale",
    created_at: new Date(now.getTime() - 40 * day).toISOString()
  }, now), null);
});

test("sendDeckSoftPull skips a fresh file when post-purchase is on", async () => {
  const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const db = {
    async query(sql) {
      const s = String(sql);
      if (/FROM crs_results/i.test(s)) {
        return { rows: [{ id: "crs-fresh", created_at: createdAt, result: {} }] };
      }
      throw new Error("send must not write when the file is fresh: " + s.slice(0, 80));
    }
  };
  const out = await sendDeckSoftPull(db, {
    orgId: ORG,
    clientId: CID,
    staffId: "s1",
    env: ENV_ON
  });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, "fresh_pull_on_file");
  assert.equal(out.crs_result_id, "crs-fresh");
  assert.equal(out.last_pull_at, createdAt);
});

test("sendDeckSoftPull with a fresh file still uses the existing send path when the flag is off", async () => {
  const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const db = {
    async query(sql) {
      const s = String(sql);
      if (/FROM crs_results/i.test(s)) {
        return { rows: [{ id: "crs-fresh", created_at: createdAt, result: {} }] };
      }
      throw new Error("unexpected sql: " + s.slice(0, 80));
    }
  };
  await assert.rejects(
    () => sendDeckSoftPull(db, { orgId: ORG, clientId: CID, staffId: "s1", env: {} }),
    (e) => e instanceof CloserDeckError && e.code === "commas_not_configured" && e.status === 503
  );
});

test("sendDeckSoftPull with no file still uses the existing send path", async () => {
  const db = {
    async query(sql) {
      const s = String(sql);
      if (/FROM crs_results/i.test(s)) return { rows: [] };
      throw new Error("unexpected sql: " + s.slice(0, 80));
    }
  };
  await assert.rejects(
    () => sendDeckSoftPull(db, { orgId: ORG, clientId: CID, staffId: "s1", env: {} }),
    (e) => e instanceof CloserDeckError && e.code === "commas_not_configured" && e.status === 503
  );
});

test("sendDeckSoftPull with a stale file still uses the existing send path", async () => {
  const createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const db = {
    async query(sql) {
      const s = String(sql);
      if (/FROM crs_results/i.test(s)) {
        return { rows: [{ id: "crs-stale", created_at: createdAt, result: {} }] };
      }
      throw new Error("unexpected sql: " + s.slice(0, 80));
    }
  };
  await assert.rejects(
    () => sendDeckSoftPull(db, { orgId: ORG, clientId: CID, staffId: "s1", env: {} }),
    (e) => e instanceof CloserDeckError && e.code === "commas_not_configured" && e.status === 503
  );
});

test("with no credit result at all the pull status stays honest", async () => {
  const out = await buildCloserDeck(fakeDb({ client: CLIENT }), { orgId: ORG, clientId: CID });
  assert.equal(out.soft_pull.pull_status, null);
  assert.equal(out.soft_pull.pull_status_source, null);
});

test("selectedOfferKey: funding vs descent vs education", () => {
  assert.equal(selectedOfferKey({ edu: false, forceRepair: false, tier: "FULL_FUNDING", rung: 0 }), "FUNDING_DFY");
  assert.equal(selectedOfferKey({ edu: false, forceRepair: true, tier: "FULL_FUNDING", rung: 0 }), "REPAIR_DFY");
  assert.equal(selectedOfferKey({ edu: false, forceRepair: true, tier: "FULL_FUNDING", rung: 1 }), "REPAIR_TRIAL");
  assert.equal(selectedOfferKey({ edu: true, forceRepair: false, tier: "REPAIR_ONLY", rung: 0 }), "FUNDING_MASTERY");
  assert.equal(selectedOfferKey({ edu: true, forceRepair: false, tier: "REPAIR_ONLY", rung: 1 }), "UWIQ_DELIVERABLES");
});

test("first-sale offers skip the upsell gate; deliverables still require it", async () => {
  const db = fakeDb({ client: CLIENT });
  const args = {
    orgId: ORG,
    clientId: CID,
    staffId: "s1",
    checkoutBaseUrl: "https://pay.example/checkout",
    env: {}
  };
  for (const offerKey of ["SOFT_PULL", "FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "FUNDING_MASTERY"]) {
    await assert.rejects(
      () => sendDeckPayLink(db, { ...args, offerKey }),
      (e) => e instanceof CloserDeckError && e.code !== "sale_motion_required",
      offerKey + " must mint as a first sale"
    );
  }
  await assert.rejects(
    () => sendDeckPayLink(db, { ...args, offerKey: "UWIQ_DELIVERABLES" }),
    (e) => e instanceof CloserDeckError && e.code === "sale_motion_required" && e.status === 400
  );
  await assert.rejects(
    () => sendDeckPayLink(db, { ...args, offerKey: "UWIQ_DELIVERABLES", saleMotion: "upsell" }),
    (e) => e instanceof CloserDeckError && e.code !== "sale_motion_required"
  );
});

test("generateDeckLetters refuses the qualified funding offer", async () => {
  await assert.rejects(
    () => generateDeckLetters(fakeDb({ client: CLIENT }), {
      orgId: ORG, clientId: CID, staffId: "s1", offerKey: "FUNDING_DFY", tier: "FULL_FUNDING"
    }),
    (e) => e instanceof CloserDeckError && e.code === "letters_blocked_funding_route" && e.status === 409
  );
});

test("Blueprint sends the resolved cents and original product into checkout persistence", async () => {
  for (const amountCents of [undefined, 500000, 750000, 1000000]) {
    let persisted;
    const db = {
      async query(sql, params) {
        if (/FROM contracts/.test(sql)) {
          const fee = formatCents(amountCents ?? 500000);
          const rendered_body = "Capital Blueprint tuition " + fee;
          return { rows: [{ id: "agreement-blueprint", status: "sent", merge_values: { package_fee: fee },
            rendered_body, body_sha: "sha256:" + createHash("sha256").update(rendered_body).digest("hex") }] };
        }
        if (/FROM products/.test(sql)) return { rows: [{ id: "product-blueprint", code: "consulting-package" }] };
        if (/INSERT INTO payment_links/.test(sql)) {
          persisted = params;
          // End the test at persistence, before a message can be queued or sent.
          throw new Error("test_checkout_captured");
        }
        return { rows: [] };
      }
    };
    await assert.rejects(() => sendDeckPayLink(db, {
      orgId: ORG, clientId: CID, staffId: "s1", offerKey: "UWIQ_DELIVERABLES",
      saleMotion: "upsell", amountCents, env: {}, checkoutBaseUrl: "https://pay.example/checkout"
    }), /test_checkout_captured/);
    assert.equal(persisted[4], amountCents ?? 500000);
    assert.equal(persisted[10], "product-blueprint");
    const url = new URL(persisted[7]);
    assert.equal(Number(url.searchParams.get("amount")), (amountCents ?? 500000) / 100);
    assert.equal(url.searchParams.get("description"), "Consulting Services Package");
  }
});

test("invalid or non-Blueprint price overrides stop before checkout and database work", async () => {
  let queries = 0;
  const db = { async query() { queries++; throw new Error("must not query"); } };
  for (const [offerKey, amountCents] of [
    ["UWIQ_DELIVERABLES", 499900], ["UWIQ_DELIVERABLES", 1000100],
    ["UWIQ_DELIVERABLES", 500001], ["UWIQ_DELIVERABLES", "750000"],
    ["REPAIR_DFY", 500000], ["FUNDING_DFY", 750000], ["SOFT_PULL", 3200]
  ]) {
    await assert.rejects(() => sendDeckPayLink(db, {
      orgId: ORG, clientId: CID, staffId: "s1", offerKey, amountCents, env: {}
    }), (e) => e.code === "invalid_offer_amount" && e.status === 400);
  }
  assert.equal(queries, 0);
});

test("Whop is only selectable for Blueprint and unsupported providers stop before writes", async () => {
  const db = { async query() { throw new Error("must not query"); } };
  for (const [offerKey, provider] of [["REPAIR_DFY", "whop"], ["FUNDING_DFY", "whop"], ["UWIQ_DELIVERABLES", "unknown"]]) {
    await assert.rejects(() => sendDeckPayLink(db, {
      orgId: ORG, clientId: CID, staffId: "s1", offerKey, provider, env: {}
    }), (e) => e.code === "invalid_offer_provider" && e.status === 400);
  }
});

/* Hole 16 — a multi-company file was priced off business ages nobody asked
   for. The deck payload now carries every company and its incorporation date,
   so Present can ask for the ones that are blank. */
test("deck payload carries every company and its incorporation date", async () => {
  const out = await buildCloserDeck(fakeDb({
    client: CLIENT,
    businesses: [
      { id: "b1", name: "Fund Horse Holdings", age_months: 48, incorporated_date: null },
      { id: "b2", name: "Fund Horse Logistics", age_months: 79, incorporated_date: "2020-01" },
      { id: "b3", name: "Fund Horse Retail", age_months: 24, incorporated_date: null }
    ]
  }), { orgId: ORG, clientId: CID });

  assert.equal(out.businesses.length, 3);
  assert.deepEqual(out.businesses.map((b) => b.name), [
    "Fund Horse Holdings", "Fund Horse Logistics", "Fund Horse Retail"
  ]);
  assert.deepEqual(out.businesses.map((b) => b.incorporated_date), [null, "2020-01", null]);
  assert.deepEqual(out.businesses.map((b) => b.age_months), [48, 79, 24]);
});

test("a missing incorporation date stays null — never defaulted to a guess", async () => {
  const out = await buildCloserDeck(fakeDb({
    client: CLIENT,
    businesses: [{ id: "b1", name: "Only Co", age_months: null, incorporated_date: "" }]
  }), { orgId: ORG, clientId: CID });

  assert.equal(out.businesses[0].incorporated_date, null);
  assert.equal(out.businesses[0].age_months, null);
});

test("a file with no company gets an empty list, not a fake row", async () => {
  const out = await buildCloserDeck(fakeDb({ client: CLIENT }), { orgId: ORG, clientId: CID });
  assert.deepEqual(out.businesses, []);
});

/* THE THREE TESTS ABOVE ALL PASSED THROUGH A LIVE OUTAGE.

   fakeDb hands back whatever rows the test names and never looks at the SQL, so
   it happily answered a query that a real Postgres refuses. From 2026-09-03 the
   deck asked `businesses` for a column called incorporated_date. There is no
   such column. Present — the deck a closer has open in front of a paying client
   — was a white page reading `column "incorporated_date" does not exist` for
   every client in the company until 2026-09-06.

   The month and year of incorporation lives inside the entity_data JSON blob,
   which is where api/soft-pull-approve.mjs puts it. This test reads the SQL the
   deck actually sends and pins that, because no fixture can. */
test("the businesses query names only columns the table really has", async () => {
  /* businesses, per db/schema/001_init.sql and confirmed against the live
     database on 2026-09-06. Anything outside this list must be reached through
     entity_data, not asked for by name. */
  const REAL_COLUMNS = [
    "id", "org_id", "client_id", "name", "age_months",
    "entity_data", "created_at", "updated_at"
  ];

  let bizSql = null;
  const spy = {
    async query(sql) {
      const s = String(sql);
      if (/FROM businesses/i.test(s) && !/FROM clients c/i.test(s)) bizSql = s;
      if (/FROM clients c/i.test(s)) return { rows: [CLIENT] };
      return { rows: [] };
    }
  };
  await buildCloserDeck(spy, { orgId: ORG, clientId: CID });
  assert.ok(bizSql, "the deck must read the client's companies");

  // The select list, between SELECT and FROM.
  const selectList = bizSql.slice(
    bizSql.toUpperCase().indexOf("SELECT") + 6,
    bizSql.toUpperCase().indexOf("FROM")
  );

  assert.ok(
    /entity_data\s*->>\s*'incorporated_date'/.test(selectList),
    "the incorporation date must be read out of entity_data"
  );

  /* What is left after the output names (`AS foo`) and the JSON keys ('foo')
     are removed is only the things this query asks the TABLE for. */
  const asked = selectList
    .replace(/\bAS\s+[a-z_][a-z0-9_]*/gi, " ")
    .replace(/'[^']*'/g, " ");

  assert.ok(
    !/\bincorporated_date\b/i.test(asked),
    "incorporated_date must never be asked for as a bare column — it is not one"
  );

  // Everything the query asks the table for has to be a real column.
  const ALLOWED = new Set(REAL_COLUMNS);
  const identifiers = asked.match(/[a-z_][a-z0-9_]*/gi) || [];
  for (const id of identifiers) {
    assert.ok(
      ALLOWED.has(id.toLowerCase()),
      `the businesses query names "${id}", which is not a column on businesses`
    );
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE LETTERS HAVE TO SURVIVE THE CALL.

   generateDeckLetters used to build the pack, count the files, email the client
   that their correction letters were ready, and then let every PDF fall out of
   memory. Nothing was saved anywhere. These run the real entry point against the
   real repair pack — the same sandbox pull ../underwrite/output-baseline.test.mjs
   pins — and prove the bytes land in the documents registry.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A client who reached R4 on a confirmed bureau answer — this releases the complaints. */
const ESCALATED_R4 = Object.freeze([
  Object.freeze({ bureau: "EX", creditor: "EXAMPLE BANK NA", account_last4: "1234", round: "R4" })
]);

const SANDBOX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../vendor/underwriteiq-full/api/lite/crs/sandbox"
);
const loadSandbox = (name) => JSON.parse(readFileSync(path.join(SANDBOX, name), "utf8"));
const sandboxPull = () => mergeBureauReports({
  reports: { TU: loadSandbox("tu.json"), EX: loadSandbox("exp.json"), EQ: loadSandbox("efx.json") },
  requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
  environment: "sandbox"
});

/**
 * A db that answers what generateDeckLetters actually asks for, and hands every
 * documents-registry statement to the registry double. No message_templates row
 * exists on purpose: sendTemplated returns template_pending without touching a
 * provider, which keeps these tests about storage and nothing else.
 */
function letterPackDb(storedCrs, priorOutcomes = []) {
  const docs = makeFakeDb();
  const clientPatches = [];
  const tagWrites = [];
  return {
    _documents: docs._documents,
    _versions: docs._versions,
    clientPatches,
    tagWrites,
    async query(sql, params) {
      const s = String(sql);
      if (/FROM clients/i.test(s)) {
        return { rows: [{
          first_name: "Fixture",
          last_name: "Client",
          custom_fields: {},
          outcome_tier: "REPAIR_ONLY"
        }] };
      }
      // The home address sits on the identity record, where the letters read it
      // (letter-pack.mjs NO_HOME_ADDRESS). Same address the fixture always used.
      if (/FROM pii_identity/i.test(s)) {
        return { rows: [{ addresses: [{ addressLine1: "100 Test Ave", city: "Denton", state: "TX", postalCode: "76205" }] }] };
      }
      if (/FROM crs_results/i.test(s)) return { rows: storedCrs ? [{ result: storedCrs }] : [] };
      if (/FROM dispute_items/i.test(s)) return { rows: [...priorOutcomes] };
      if (/FROM message_templates/i.test(s)) return { rows: [] };
      if (/UPDATE clients SET tags/i.test(s)) {
        tagWrites.push(params?.[1]);
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE clients SET custom_fields/i.test(s)) {
        clientPatches.push(JSON.parse(params[1]));
        return { rows: [], rowCount: 1 };
      }
      return docs.query(sql, params);
    }
  };
}

test("generateDeckLetters SAVES the repair pack — the PDFs reach the documents registry", async () => {
  const db = letterPackDb(sandboxPull(), ESCALATED_R4);
  const store = createStore({ provider: memoryProvider() });

  const out = await generateDeckLetters(db, {
    orgId: ORG, clientId: CID, staffId: "s1", offerKey: "REPAIR_DFY", tier: "REPAIR_ONLY", store
  });

  assert.equal(out.delivered, true);
  assert.equal(out.persistSkipped, null, "the pack was stored, not skipped");
  assert.ok(out.documentsStored > 0,
    "the client is told their letters are ready — something has to have been saved");

  // Every stored row belongs to this org and this client. A document with the
  // wrong stamp is a cross-tenant leak, not a filing mistake.
  assert.ok(db._documents.length > 0);
  assert.ok(db._documents.every((d) => d.org_id === ORG && d.client_id === CID));
  assert.ok(db._documents.every((d) => d.kind === "deliverable"));

  const subtypes = db._documents.map((d) => d.subtype);
  assert.ok(subtypes.includes("metro2_dispute_letter_pack"), "no dispute letter was stored");
  assert.ok(subtypes.includes("cfpb_complaint"), "the CFPB complaint was not stored");
  // Classified off the file's own type. Its filename is
  // "State-Attorney-General-Complaint.pdf", which no filename rule would match.
  assert.ok(subtypes.includes("state_ag_complaint"), "the state AG complaint was not stored");

  // The complaint cover sheet is text. It must never be registered as a PDF.
  assert.ok(!db._documents.some((d) => /\.txt/i.test(d.title || "")),
    "a text cover sheet was stored as application/pdf");

  // The bytes are real and readable back out of the store.
  const first = db._documents[0];
  const got = await store.get(first.storage_key);
  assert.equal(got.body.subarray(0, 4).toString(), "%PDF", `${first.title} is not a PDF`);
});

test("generateDeckLetters records a storage failure instead of losing the call", async () => {
  /* ASSERTION MOVED 2026-09-04, F41. This used to pin `delivered: true` when the
     bucket was unreachable and zero documents were stored — and `delivered` is
     what releases the "your documents are ready" email and what the presenter's
     screen prints. That is the defect: the client was told their pack was ready
     over an empty store. Nothing about the ORIGINAL intent is weakened — the
     storage failure is still reported rather than swallowed, and the call
     outcome is still stamped on the client — and the test now also pins that
     nothing was sent and nothing was tagged. */
  const db = letterPackDb(sandboxPull());
  const brokenStore = {
    name: "broken",
    async put() { throw new Error("bucket unreachable"); },
    async get() { return null; },
    async del() {}
  };

  const out = await generateDeckLetters(db, {
    orgId: ORG, clientId: CID, staffId: "s1", offerKey: "REPAIR_DFY", tier: "REPAIR_ONLY",
    store: brokenStore
  });

  assert.ok(out.letterCount > 0, "the letters were still generated");
  assert.equal(out.documentsStored, 0);
  assert.equal(out.delivered, false, "nothing was saved, so nothing was delivered");
  assert.match(out.persistSkipped, /bucket unreachable/,
    "a storage failure has to be reported, not swallowed");
  assert.match(out.reason, /bucket unreachable/,
    "the screen has to be able to say WHY nothing went out");
  assert.equal(out.email, null, "no email may go out over an empty store");
  assert.deepEqual(db.tagWrites, [], "no client tag over an empty store");
  assert.equal(db.clientPatches.at(-1).diy_status, "Delivery Failed — Retry",
    "the call outcome is still stamped on the client");
});

test("F41 — the deliverables button sends the FUNDING pack, not the repair pack", async () => {
  /* The education path's button reads "Send deliverables package now". It used
     to ask for the REPAIR pack, which is zero files on a clean file, and then
     email the client that their correction letters were ready. */
  const db = letterPackDb(sandboxPull());
  const store = createStore({ provider: memoryProvider() });

  const out = await generateDeckLetters(db, {
    orgId: ORG, clientId: CID, staffId: "s1", offerKey: "UWIQ_DELIVERABLES", edu: true, store
  });

  assert.equal(out.pack, "deliverables");
  assert.equal(out.delivered, true);
  assert.ok(out.documentsStored >= 4, "the analysis documents have to be saved");
  const subtypes = db._documents.map((d) => d.subtype);
  /* The four analysis reports always come out of the funding pack. The fifth,
     the Capital Readiness Summary, is emitted by the vendor's buildDocuments
     only on a funding OUTCOME — the sandbox pull here scores repair — so it is
     pinned where it belongs, in ../underwrite/funding-letter-pdf.test.mjs. */
  for (const wanted of [
    "credit_analysis_report", "funding_snapshot", "bank_lender_match_list",
    "credit_optimization_roadmap"
  ]) {
    assert.ok(subtypes.includes(wanted), `${wanted} was not saved to the portal`);
  }
  assert.equal(subtypes.includes("metro2_dispute_letter_pack"), false,
    "a deliverables package must not carry Metro 2 dispute letters");
});

test("F41 — an empty pack sends nothing and says why", async () => {
  // No stored credit pull at all: there is nothing to build a pack out of.
  const db = letterPackDb(null);
  const store = createStore({ provider: memoryProvider() });

  const out = await generateDeckLetters(db, {
    orgId: ORG, clientId: CID, staffId: "s1", offerKey: "UWIQ_DELIVERABLES", edu: true, store
  });

  assert.equal(out.delivered, false);
  assert.equal(out.letterCount, 0);
  assert.equal(out.documentsStored, 0);
  assert.ok(out.reason, "the screen must be given a reason to print");
  assert.equal(out.email, null, "no email over an empty pack");
  assert.deepEqual(db.tagWrites, [], "no tag over an empty pack");
  assert.deepEqual(db._documents, [], "no document row over an empty pack");
});

/* ── F48: the pay-link text says who it is from and what it is for ────────────
 *
 * Received 2026-09-03: "Hi Sim, Fundhub Capital Academy: pay $5,000 <link>".
 * The owner's verdict on his own product was that it reads like spam. It is one
 * message either way — this is about what it says, not how many go out.
 */
test("F48: the pay-link text names the sender, the offer, the call and the way out", async () => {
  const { payLinkSmsBody } = await import("./closer-deck.mjs");
  const body = payLinkSmsBody({
    firstName: "Sim",
    description: "Capital Academy",
    amount: "$5,000",
    checkoutUrl: "https://pay.example.com/abc123"
  });
  assert.match(body, /Hi Sim/);
  assert.match(body, /it's Fundhub/);
  assert.match(body, /Capital Academy/);
  assert.match(body, /\$5,000/);
  assert.match(body, /https:\/\/pay\.example\.com\/abc123/);
  assert.match(body, /from your call/);
  assert.match(body, /Reply here/);
  // The shipped opt-out line, exactly as every other text carries it.
  assert.match(body, /Reply STOP to opt out\./);
  // And the shape the owner called slop is gone.
  assert.doesNotMatch(body, /Fundhub Capital Academy: pay/);
});
