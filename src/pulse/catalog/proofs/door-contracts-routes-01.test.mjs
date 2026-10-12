import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import logoutHandler from "../../../../api/auth/logout.mjs";
import financeModelHandler from "../../../../api/finance/model.mjs";
import pushKeyHandler from "../../../../api/push/key.mjs";
import trialEligibilityHandler from "../../../../api/trials/eligibility.mjs";
import { hashToken } from "../../../auth/session.mjs";
import { generateVapidKeys } from "../../../push/crypto.mjs";
import {
  ORG_ID,
  accountSession,
  fakeDb,
  makeRes,
  req,
  runWithSharedDb,
  staffSession,
} from "../../../testing/handler-harness.mjs";
import {
  DOOR_CONTRACTS_ROUTES_01_PROOFS,
  DOOR_CONTRACTS_ROUTES_01_ROW_KEYS,
  doorContractsRoutes01Proof,
  doorContractsRoutes01RowKey,
} from "./door-contracts-routes-01.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const GENERATED = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"),
).items.filter((row) => ["routes-0.json", "routes-1.json"].includes(row.sourceFile));
const CLIENT_ID = "f3263bdb-45da-4056-8d6c-7c999d944fee";

async function invoke(handler, request, database = fakeDb()) {
  const response = makeRes();
  await runWithSharedDb(database, () => handler(request, response));
  return { response, database };
}

function financeDatabase() {
  const cards = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      org_id: ORG_ID,
      client_id: CLIENT_ID,
      lender: "Amex",
      kind: "revolving",
      credit_limit_cents: "1000000",
      balance_cents: "0",
      apr: "0.18990",
      closed_at: null,
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      org_id: ORG_ID,
      client_id: CLIENT_ID,
      lender: "Chase Ink",
      kind: "revolving",
      credit_limit_cents: "500000",
      balance_cents: "0",
      apr: "0.24990",
      closed_at: null,
    },
  ];
  return fakeDb([
    staffSession(),
    [/FROM clients WHERE/, [{ "?column?": 1 }]],
    [/FROM upsell_triggers/, []],
    [/FROM tradelines/, cards],
  ]);
}

async function proveFinanceModel() {
  const body = {
    client_id: CLIENT_ID,
    approved_funding: 250000,
    fee_pct: 0.1,
    down_payment: 3000,
    existing_debts: 12000,
    requested_amount: 18000,
    intro_months: 12,
    post_intro_apr: 0.249,
    min_payment_pct: 0.02,
  };
  const { response, database } = await invoke(
    financeModelHandler,
    req("POST", { body }),
    financeDatabase(),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.units, "dollars");
  assert.equal(response.body.client_id, CLIENT_ID);
  assert.deepEqual(response.body.guardrail_threshold, {
    value: 0.3,
    source: "default",
    note: null,
  });
  assert.deepEqual(response.body.deal.cashPosition, {
    netCashToClient: 222000,
    deposit: 3000,
    fee: { total: 25000, paidDown: 0, fromProceeds: 25000 },
  });
  assert.deepEqual(response.body.deal.monthly, {
    intro: {
      month1Payment: 5000,
      note: "Minimum payment steps down each month as balance declines.",
      schedule: [
        { month: 1, openingBalance: 250000, payment: 5000 },
        { month: 2, openingBalance: 245000, payment: 4900 },
        { month: 3, openingBalance: 240100, payment: 4802 },
        { month: 4, openingBalance: 235298, payment: 4705.96 },
        { month: 5, openingBalance: 230592.04, payment: 4611.84 },
        { month: 6, openingBalance: 225980.1992, payment: 4519.6 },
        { month: 7, openingBalance: 221460.59521600002, payment: 4429.21 },
        { month: 8, openingBalance: 217031.38331168002, payment: 4340.63 },
        { month: 9, openingBalance: 212690.75564544642, payment: 4253.82 },
        { month: 10, openingBalance: 208436.9405325375, payment: 4168.74 },
        { month: 11, openingBalance: 204268.20172188675, payment: 4085.36 },
        { month: 12, openingBalance: 200182.837687449, payment: 4003.66 },
      ],
      balanceAtIntroExpiry: 196179.18,
    },
    postIntro: { interestOnlyMonthly: 4070.72 },
    amort: {
      fundingAmount: 0,
      monthlyPayment: null,
      amortApr: null,
      amortTermMonths: null,
    },
  });
  assert.deepEqual(response.body.deal.cliff, {
    triggered: true,
    interest: 4070.72,
    minPayment: 3923.58,
    message:
      "Post-intro interest ($4,070.72/mo) exceeds the minimum payment ($3,923.58/mo). Balance will grow unless refinanced or paid down before month 13.",
  });
  assert.deepEqual(response.body.net, {
    approved_funding: 250000,
    success_fee: 25000,
    fee_from_proceeds: 25000,
    fee_paid_out_of_pocket: 0,
    deposit: 3000,
    net_cash_to_client: 222000,
    existing_debts: 12000,
    existing_debts_source: "entered_on_this_screen",
    net_cash_after_debts: 210000,
  });
  assert.deepEqual(response.body.funding.allocation, {
    requestedAmount: 18000,
    totalDrawn: 15000,
    shortfall: 3000,
    fullyFunded: false,
    draws: [
      {
        lender: "Amex",
        creditLimit: 10000,
        currentBalance: 0,
        availableHeadroom: 10000,
        apr: 0.1899,
        draw: 10000,
      },
      {
        lender: "Chase Ink",
        creditLimit: 5000,
        currentBalance: 0,
        availableHeadroom: 5000,
        apr: 0.2499,
        draw: 5000,
      },
    ],
  });
  assert.deepEqual(response.body.funding.payMethodComparison, {
    blendedApr: 0.2099,
    horizons: [
      {
        months: 12,
        lumpSum: { monthlyPayment: null, totalInterest: 3148.5, totalPaid: 18148.5, remainingBalance: 0 },
        interestOnly: { monthlyPayment: 262.38, totalInterest: 3148.56, totalPaid: 18148.56, remainingBalance: 15000 },
        minPayments: { monthlyPaymentMonth1: 305.25, totalInterest: 3099.47, totalPaid: 3605.93, remainingBalance: 14493.54 },
      },
      {
        months: 24,
        lumpSum: { monthlyPayment: null, totalInterest: 6297, totalPaid: 21297, remainingBalance: 0 },
        interestOnly: { monthlyPayment: 262.38, totalInterest: 6297.12, totalPaid: 21297.12, remainingBalance: 15000 },
        minPayments: { monthlyPaymentMonth1: 305.25, totalInterest: 6094.3, totalPaid: 7090.12, remainingBalance: 14004.18 },
      },
      {
        months: 36,
        lumpSum: { monthlyPayment: null, totalInterest: 9445.5, totalPaid: 24445.5, remainingBalance: 0 },
        interestOnly: { monthlyPayment: 262.38, totalInterest: 9445.68, totalPaid: 24445.68, remainingBalance: 15000 },
        minPayments: { monthlyPaymentMonth1: 305.25, totalInterest: 8988.01, totalPaid: 10456.66, remainingBalance: 13531.35 },
      },
    ],
  });
  assert.deepEqual(response.body.funding.guardrail, {
    threshold: 0.3,
    aggregateUtilizationBefore: 0,
    aggregateUtilization: 1,
    aggregateUtilizationDelta: 1,
    aggregateBreaches: true,
    perCard: [
      {
        lender: "Amex",
        utilizationBefore: 0,
        utilizationAfter: 1,
        utilizationDelta: 1,
        newUtilization: 1,
        causedBreach: true,
        preExistingOver: false,
        breaches: true,
      },
      {
        lender: "Chase Ink",
        utilizationBefore: 0,
        utilizationAfter: 1,
        utilizationDelta: 1,
        newUtilization: 1,
        causedBreach: true,
        preExistingOver: false,
        breaches: true,
      },
    ],
    hardStop: true,
    message:
      "HARD STOP: this draw pushes aggregate utilization across 30% (to 100.0%) and 2 card(s) across 30%. The draw itself is what triggers the score-drop threshold that kills the next funding round. Reduce the draw or restructure the allocation.",
  });
  assert.equal(response.body.funding.totalAvailableCredit, 15000);
  assert.equal(response.body.funding.lenderMatchCount, null);
  assert.equal(response.body.funding.lenderMatches, null);
  assert.equal(response.body.funding.lenderMatchSummary, null);
  assert.deepEqual(response.body.cards, {
    source: "tradelines",
    on_file: 2,
    considered: 2,
    excluded_installment: 0,
    excluded_no_credit_limit: 0,
    balance_unknown: 0,
    apr_unknown: 0,
    list: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        lender: "Amex",
        credit_limit: 10000,
        current_balance: 0,
        balance_known: true,
        apr: 0.1899,
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        lender: "Chase Ink",
        credit_limit: 5000,
        current_balance: 0,
        balance_known: true,
        apr: 0.2499,
      },
    ],
  });
  assert.deepEqual(response.body.reasons, []);
  assert.equal(database.find(/INSERT|DELETE/).length, 0);
  assert.equal(database.find(/UPDATE (?!sessions)/).length, 0);

  const refused = await invoke(
    financeModelHandler,
    req("POST", { body: { approved_funding: 250000, fee_pct: 10 } }),
    financeDatabase(),
  );
  assert.equal(refused.response.statusCode, 400);
  assert.deepEqual(refused.response.body, {
    ok: false,
    error: "fee_pct is a fraction, not a percentage — 0.10 means 10%",
  });
}

async function proveLogout() {
  const token = "door-contract-logout-token";
  const called = await invoke(logoutHandler, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(called.response.statusCode, 200);
  assert.deepEqual(called.response.body, { ok: true });
  assert.match(called.response.headers["set-cookie"], /^fundhub_session=;.*Max-Age=0/);
  assert.deepEqual(called.database.find(/UPDATE sessions SET revoked_at/)[0].params, [hashToken(token)]);
  assert.deepEqual(called.database.find(/UPDATE account_sessions SET revoked_at/)[0].params, [hashToken(token)]);
  assert.equal(called.database.calls.some((call) => call.params.includes(token)), false);

  const refused = await invoke(logoutHandler, { method: "GET", headers: {} });
  assert.equal(refused.response.statusCode, 405);
  assert.deepEqual(refused.response.body, { ok: false, error: "method_not_allowed" });
  assert.equal(refused.database.calls.length, 0);
}

const QUESTIONS = [
  {
    key: "has_ad_account",
    question: "Do you have a Meta ad account?",
    why: "The campaign runs in your account, under your brand. FundHub never runs it from ours.",
    onNo: "We will walk you through the two-minute setup first. Nothing is charged until it exists.",
  },
  {
    key: "business_verified",
    question: "Is your Meta business verified?",
    why: "Meta will not run a money-related ad from a business it has not verified. That check is theirs, not ours.",
    onNo: "You can still start today. We build everything now and your seven days begin the day verification lands.",
  },
  {
    key: "can_fund_ad_spend",
    question: "Can you fund $500 to $1,000 of ad spend this week?",
    why: "The $297 does not buy ad spend. The budget is yours, on your card, in your account.",
    onNo: "We will hold the sale. Without a budget there is nothing for the campaign to spend.",
  },
];

const GUARANTEE = [
  "If FundHub does not deliver your branded page, your ad set, your live dashboard and your campaign by the end of day one, you get every dollar back, automatically, without asking.",
  "If you run the full 7 days with at least $500 in spend, your account stays active the whole time, and no call books, you get: a written breakdown of why, at no charge; 7 more days of the machine, at no charge; and your $297 credited in full toward the $10,000 if you join within 30 days.",
];

function trialExpected(overrides) {
  return {
    ok: true,
    decision: "sell",
    sellable: true,
    held_start: false,
    blockers: [],
    headline: "You are ready. Your seven days start at your first ad impression.",
    terms: [
      "Your seven days start at your first ad impression, not at checkout.",
      "The $297 does not include ad spend. Plan on $500 to $1,000 this week, on your own card.",
      "Everything runs in your ad account, under your brand.",
    ],
    questions: QUESTIONS,
    price_cents: 29700,
    trial_days: 7,
    ad_spend_included: false,
    guarantee: GUARANTEE,
    ...overrides,
  };
}

async function callTrial(body) {
  const response = makeRes();
  await trialEligibilityHandler({ method: "POST", body }, response);
  return response;
}

async function proveTrialEligibility() {
  const sell = await callTrial({
    has_ad_account: true,
    business_verified: true,
    can_fund_ad_spend: true,
  });
  assert.equal(sell.statusCode, 200);
  assert.deepEqual(sell.body, trialExpected());

  const held = await callTrial({
    has_ad_account: true,
    business_verified: false,
    can_fund_ad_spend: true,
  });
  assert.equal(held.statusCode, 200);
  assert.deepEqual(held.body, trialExpected({
    decision: "held_start",
    held_start: true,
    headline: "You can start today. Your seven days start when Meta verifies you.",
    terms: [
      "We build your branded funnel and your ad set now. That is delivered whether or not verification is quick.",
      "Your seven live days begin on the day verification lands — not today.",
      "If Meta refuses your verification within 30 days, you get every dollar back automatically.",
      "We cannot tell you how long Meta takes. It is their system and we have no measured number for it.",
    ],
  }));

  const blocked = await callTrial({
    has_ad_account: false,
    business_verified: true,
    can_fund_ad_spend: false,
  });
  assert.equal(blocked.statusCode, 200);
  assert.deepEqual(blocked.body, trialExpected({
    decision: "hold_sale",
    sellable: false,
    blockers: [
      {
        key: "has_ad_account",
        reason: "no_ad_account",
        message: "You need a Meta ad account before the campaign has anywhere to run. It takes about two minutes.",
      },
      {
        key: "can_fund_ad_spend",
        reason: "no_ad_budget",
        message: "The $297 does not include ad spend. Plan on $500 to $1,000 this week, on your own card.",
      },
    ],
    headline: "Not yet — one thing first.",
    terms: [],
  }));

  const invalid = makeRes();
  await trialEligibilityHandler({ method: "POST", body: "{" }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.body, { ok: false, error: "invalid_json" });
}

async function withPushEnv(fn) {
  const names = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "PUSH_SUB_ENC_KEY"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const keys = generateVapidKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:door-contract@example.test";
  process.env.PUSH_SUB_ENC_KEY = crypto.randomBytes(32).toString("base64");
  try {
    return await fn(keys);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

function clientDatabase() {
  return fakeDb(accountSession({ kind: "client", clientId: CLIENT_ID }));
}

async function provePushKey() {
  await withPushEnv(async (keys) => {
    const ready = await invoke(pushKeyHandler, req("GET"), clientDatabase());
    assert.equal(ready.response.statusCode, 200);
    assert.deepEqual(ready.response.body, {
      ok: true,
      configured: true,
      public_key: keys.publicKey,
    });
    assert.equal(JSON.stringify(ready.response.body).includes(keys.privateKey), false);

    delete process.env.PUSH_SUB_ENC_KEY;
    const noStorage = await invoke(pushKeyHandler, req("GET"), clientDatabase());
    assert.equal(noStorage.response.statusCode, 200);
    assert.deepEqual(noStorage.response.body, {
      ok: true,
      configured: false,
      public_key: keys.publicKey,
    });

    process.env.PUSH_SUB_ENC_KEY = crypto.randomBytes(32).toString("base64");
    delete process.env.VAPID_PRIVATE_KEY;
    const noPrivateKey = await invoke(pushKeyHandler, req("GET"), clientDatabase());
    assert.equal(noPrivateKey.response.statusCode, 200);
    assert.deepEqual(noPrivateKey.response.body, {
      ok: true,
      configured: false,
      public_key: null,
    });
  });

  const unsigned = await invoke(pushKeyHandler, { method: "GET", headers: {} }, fakeDb());
  assert.equal(unsigned.response.statusCode, 401);
  assert.deepEqual(unsigned.response.body, { ok: false, error: "unauthorized" });
}

const RUNNERS = new Map([
  ["route:finance/model", proveFinanceModel],
  ["route:auth/logout", proveLogout],
  ["route:push/key", provePushKey],
  ["route:trials/eligibility", proveTrialEligibility],
]);

test("Door 01 exports only exact row keys whose real handler result this shard proves", async (t) => {
  assert.equal(DOOR_CONTRACTS_ROUTES_01_PROOFS.length, 4);
  assert.deepEqual(
    [...DOOR_CONTRACTS_ROUTES_01_ROW_KEYS].sort(),
    DOOR_CONTRACTS_ROUTES_01_PROOFS.map((entry) => entry.key).sort(),
  );

  const exercised = new Set();
  for (const entry of DOOR_CONTRACTS_ROUTES_01_PROOFS) {
    await t.test(entry.key, async () => {
      const rows = JSON.parse(fs.readFileSync(path.join(MAP, entry.sourceFile), "utf8"));
      const row = rows.find(
        (candidate) => candidate.surface === entry.surface && candidate.control === entry.control,
      );
      assert.ok(row, `missing catalog row ${entry.key}`);
      assert.equal(doorContractsRoutes01RowKey(entry.sourceFile, row), entry.key);
      assert.deepEqual(doorContractsRoutes01Proof(entry.sourceFile, row), entry.proof);
      const generated = GENERATED.find((candidate) => candidate.id === entry.generatedId);
      assert.ok(generated, `missing generated row ${entry.generatedId}`);
      assert.equal(generated.sourceFile, entry.sourceFile);
      assert.equal(generated.surface, entry.surface);
      assert.equal(generated.proofVerdict, "red");
      assert.equal(typeof RUNNERS.get(entry.surface), "function", `missing runner ${entry.surface}`);
      await RUNNERS.get(entry.surface)();
      exercised.add(entry.key);
    });
  }

  assert.deepEqual([...exercised].sort(), [...DOOR_CONTRACTS_ROUTES_01_ROW_KEYS].sort());
});
