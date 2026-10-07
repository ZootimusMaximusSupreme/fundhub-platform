// The FinanceOS test client's sample credit file. Pure; no db, no network.
// The file is built from the bank's numbers (sandbox bank v3) and handed to the
// real engines; these tests pin both halves.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSampleCreditFile, withEngineResult, countFields, sampleProviderResultId,
  SAMPLE_NOTICE, SAMPLE_PROVIDER, SAMPLE_SCORES
} from "./sample-credit-file.mjs";
import { planMixedSandboxUser } from "../banking/plaid-sandbox-user.mjs";
import { runTierEngineFromCrsResult } from "./crs-tier.mjs";
import { isSampleResult, triMerge } from "../http/client-detail.mjs";
import { normalizeFromCrs } from "../tradelines/index.mjs";
import { normalizeLiabilitiesFromCrs } from "../liabilities/index.mjs";
import { buildCreditOverview } from "./credit-overview.mjs";

const PULLED_AT = "2026-10-07T03:30:00.000Z";
const { facts } = planMixedSandboxUser({ today: new Date(PULLED_AT) });
const v = facts.accounts.find((a) => a.name === "Personal Visa");
const VISA = {
  mask: v.mask, balanceCents: v.currentCents, limitCents: v.limitCents, aprPct: v.purchaseApr,
  minimumPaymentCents: v.minimumPaymentCents, highBalanceCents: v.maxEodCents, lastActivityOn: v.lastPostedOn
};
const { payload, counts } = buildSampleCreditFile({ pulledAt: PULLED_AT, person: { first: "Test", last: "Test" }, visa: VISA });
const visaRow = payload.tradelines.find((t) => t.accountType === "Revolving");
const autoRow = payload.tradelines.find((t) => t.accountType === "Installment");

test("the Personal Visa on the report is the bank's Personal Visa: limit, balance, APR, minimum, last four", () => {
  assert.equal(visaRow.creditorName, "FIRST PLATYPUS BANK");
  assert.equal(visaRow.creditLimitAmount, String(v.limitCents / 100));
  assert.equal(visaRow.currentBalanceAmount, String(v.currentCents / 100));
  assert.equal(visaRow.currentBalance, String(v.currentCents / 100));
  assert.equal(Number(visaRow.apr), v.purchaseApr);
  assert.equal(visaRow.monthlyPaymentAmount, String(Math.ceil(v.minimumPaymentCents / 100)));
  assert.ok(visaRow.accountIdentifier.endsWith(v.mask));
  assert.equal(visaRow.accountStatusType, "Open");
  assert.equal(visaRow.accountReportedDate, v.lastPostedOn);
  assert.ok(Number(visaRow.highBalanceAmount) * 100 >= v.currentCents);
});

test("a bureau reports whole dollars: a balance with cents is refused, not rounded", () => {
  assert.throws(() => buildSampleCreditFile({
    pulledAt: PULLED_AT, person: { first: "Test", last: "Test" }, visa: { ...VISA, balanceCents: VISA.balanceCents + 1 }
  }), /whole dollars/);
});

test("business cards and the SBA loan are not on the personal file; their applications are", () => {
  assert.equal(payload.tradelines.length, 2);
  assert.ok(!payload.tradelines.some((t) => /AMEX|AMERICAN EXPRESS|CHASE|JPMCB|SBA/i.test(t.creditorName)));
  const inq = payload.inquiries.map((i) => `${i.source} ${i.creditorName}`).sort();
  assert.deepEqual(inq, ["EQ JPMCB CARD SERVICES", "EX AMERICAN EXPRESS", "TU FIRST PLATYPUS BANK"]);
});

test("the paid-off car loan is closed, $0, and carries the one 30-day late", () => {
  assert.equal(autoRow.accountStatusType, "Closed");
  assert.equal(autoRow.currentBalanceAmount, "0");
  assert.equal(autoRow._30DayLates, "1");
  assert.equal(autoRow.paymentPatternData.split("").filter((c) => c === "1").length, 1);
  assert.ok(autoRow.accountClosedDate < PULLED_AT.slice(0, 10));
  assert.equal(autoRow.adverseRatings.highestAdverseRatingType, "Late30Days");
});

test("counts are counted from the file", () => {
  assert.deepEqual(counts.inquiries, { EX: 1, EQ: 1, TU: 1 });
  assert.equal(counts.negativeItems, 1);
  assert.equal(counts.latePayments, 1);
  assert.equal(counts.utilizationPct, Math.round((v.currentCents / v.limitCents) * 1000) / 10);
  assert.deepEqual(countFields(counts), {
    crs_inquiries_ex: 1, crs_inquiries_eq: 1, crs_inquiries_tu: 1,
    crs_negative_items_count: 1, crs_late_payments_count: 1
  });
});

test("stamped as a sample everywhere a reader looks, and no SSN or date of birth anywhere", () => {
  assert.equal(payload.simulated, true);
  assert.equal(payload.environment, "simulated");
  assert.equal(payload.simulatedNotice, SAMPLE_NOTICE);
  assert.equal(isSampleResult(payload), true);
  for (const code of ["TU", "EX", "EQ"]) {
    assert.match(payload.bureaus[code].responseDetail.requestingParty.name, /SIMULATED/);
  }
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /"ssns?"|"dobs?"|birthDate|ssnLast4/);
  assert.doesNotMatch(text, /\b\d{3}-?\d{2}-?\d{4}\b/);
  assert.equal(SAMPLE_PROVIDER, "crs_softview_simulated");
  assert.match(sampleProviderResultId(), /^crs-simulated-bundle:[0-9a-f]{64}$/);
  assert.equal(sampleProviderResultId(), sampleProviderResultId());
});

test("the screens read the scores off it and flag them as a sample", () => {
  const t = triMerge([{ result: payload, created_at: PULLED_AT }]);
  assert.deepEqual([t.experian, t.equifax, t.transunion], [SAMPLE_SCORES.EX, SAMPLE_SCORES.EQ, SAMPLE_SCORES.TU]);
  assert.equal(t.sample, true);
});

test("the tradeline and liability ingests read both accounts, one row each", () => {
  const row = { id: "crs-1", result: payload, created_at: PULLED_AT };
  const lines = normalizeFromCrs(row);
  assert.equal(lines.length, 2);
  const visa = lines.find((l) => l.kind === "revolving");
  assert.equal(visa.balance_cents, v.currentCents);
  assert.equal(visa.credit_limit_cents, v.limitCents);
  assert.equal(visa.apr, Math.round((v.purchaseApr / 100) * 1e5) / 1e5);
  assert.ok(visa.account_ref.endsWith(v.mask));
  const auto = lines.find((l) => l.kind === "installment");
  assert.equal(auto.balance_cents, 0);
  const positions = normalizeLiabilitiesFromCrs(row);
  assert.equal(positions.length, 2);
  assert.ok(positions.every((p) => p.payment_status === "current"));
  assert.equal(positions.find((p) => p.account_ref === visa.account_ref).current_balance_cents, v.currentCents);
});

test("the tier and the funding estimate are the engine's, never typed in", () => {
  const r = withEngineResult(payload, { submittedName: "Test Test" });
  const direct = runTierEngineFromCrsResult(payload, { submittedName: "Test Test" });
  assert.equal(r.outcomeTier, direct.outcome);
  assert.equal(r.payload.outcome, direct.outcome);
  assert.deepEqual(r.payload.preapprovals, direct.preapprovals ?? null);
  assert.equal(r.fundingEstimate, direct.preapprovals.totalPersonal);
  assert.equal(r.payload.fundingEstimate, r.fundingEstimate);
  // The stamp survives the engine.
  assert.equal(r.payload.simulated, true);
  assert.equal(r.payload.environment, "simulated");
});

test("the credit overview reads it end to end: scores, card use, inquiries, negatives, UnderwriteIQ", () => {
  const crsRows = [{ id: "crs-1", result: withEngineResult(payload, { submittedName: "Test Test" }).payload, created_at: PULLED_AT }];
  const tradelineRows = normalizeFromCrs(crsRows[0]).map((l, i) => ({ id: `t${i}`, closed_at: null, ...l }));
  const out = buildCreditOverview({
    client: { id: "c", first_name: "Test", last_name: "Test", custom_fields: countFields(counts) },
    asOf: PULLED_AT,
    crsRows,
    tradelineRows,
    liabilities: [],
    businesses: [{ name: "Fundhub LLC", age_months: 67, created_at: "2026-10-06T23:38:38Z" }]
  });
  assert.equal(out.has_pull, true);
  assert.equal(out.sample, true);
  assert.equal(out.personal.experian.score, SAMPLE_SCORES.EX);
  assert.equal(out.utilization.percent, counts.utilizationPct);
  assert.equal(out.accounts.open, 1, "the car loan is closed");
  assert.equal(out.inquiries.total, 3);
  assert.equal(out.negative_items.count, 1);
  assert.equal(out.late_payments.count, 1);
  assert.ok(out.suggestions.length > 0, "UnderwriteIQ has something to say");
});
