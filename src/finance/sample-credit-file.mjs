// The FinanceOS test client's SAMPLE credit file — one person, one file
// (.claude/rules/sample-clients-consistent.md).
//
// WHO THIS IS. The same person as Plaid sandbox bank v3
// (src/banking/plaid-sandbox-user.mjs): paid by Brightline Consulting, rents at
// Oakwood Apartments, owns a car outright (GEICO, no car payment), carries a
// balance on a Personal Visa at First Platypus Bank, and runs Fundhub LLC with
// a Business Amex, a Chase Ink and an SBA loan. Mid-repair: one old 30-day late
// on a car loan that is now paid off, the Visa used at roughly 40%, three hard
// inquiries.
//
// WHAT IS ON A PERSONAL REPORT AND WHAT IS NOT.
//   * Personal Visa — yes. Its limit, balance, APR, minimum and last activity
//     are NOT typed here: the caller passes them from the linked bank, so the
//     report and the bank cannot disagree. The balance is a whole dollar because
//     bureaus report whole dollars; v3 lands the Visa on one for this reason.
//   * Business Amex, Chase Ink, SBA loan — no. Business cards and an SBA loan
//     do not report to a personal file. The APPLICATIONS do: Amex and Chase pull
//     the owner's personal credit, so their inquiries are here.
//   * The paid-off car loan — yes, closed, $0. It carries the one late payment.
//     Nothing open is added that the bank does not show: an open loan here with
//     no payment leaving checking would be a second story.
//
// WHAT THIS FILE DOES NOT DO. It never decides a tier, a funding figure or a
// suggestion. withEngineResult() hands the file to the REAL engines — the same
// scoreBuyerTotal() + runTierEngineFromCrsResult() a pull runs after the bureau
// answers (src/finance/crs-pull.mjs finishStored) — and stores what they print.
// UnderwriteIQ's sentences are worked out at read time from the stored file by
// the same calls every screen makes (src/finance/credit-overview.mjs).
//
// THE STAMP. Every place a reader looks says this is a sample and not a bureau
// pull: result.simulated, result.environment "simulated" (which every screen's
// isSampleResult() reads — src/http/client-detail.mjs), result.simulatedNotice,
// each bureau's responseDetail.requestingParty, and the stored row's provider
// "crs_softview_simulated" with a "crs-simulated-bundle:" identity
// (crs-pull.mjs CRS_SIMULATED_PROVIDER / providerResultIdFor).
//
// SHAPE. The vendor's own field names, per bureau, the way
// scripts/sim/push-credit.mjs builds its walkthrough files (that file's header
// names the real vendor payloads they are copied from), plus the flat one-row-
// per-account list with the repo spellings the tradeline and liability ingests
// read (currentBalance, apr, account_ref, paymentStatus, kind). No Social
// Security number and no date of birth are written anywhere.
//
// Pure. No database, no network, no clock (pulledAt is a parameter).

import { runTierEngineFromCrsResult } from "./crs-tier.mjs";
import { scoreBuyerTotal, providerResultIdFor, CRS_SIMULATED_PROVIDER } from "./crs-pull.mjs";

export const SAMPLE_NOTICE =
  "SIMULATED — FinanceOS sample credit file for the test client. No credit bureau was contacted.";

/** Fixed, so the stored row's identity is the same on every run (re-running
 *  the script finds it instead of adding a second file). */
export const SAMPLE_REQUEST_IDS = Object.freeze({
  TU: "financeos-sample-v3-TU",
  EX: "financeos-sample-v3-EX",
  EQ: "financeos-sample-v3-EQ"
});

export const SAMPLE_PROVIDER = CRS_SIMULATED_PROVIDER;
export const sampleProviderResultId = () => providerResultIdFor({ requestIds: SAMPLE_REQUEST_IDS, simulated: true });

const BUREAUS = Object.freeze(["EX", "EQ", "TU"]);
const BUREAU_NAME = Object.freeze({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" });

/** A sample address in the same style as the sample business address on file
 *  ("100 Sample St, Phoenix AZ 85004" — businesses.entity_data). */
export const SAMPLE_HOME = Object.freeze({ line1: "200 SAMPLE AVE APT 12", city: "PHOENIX", state: "AZ", postal_code: "85004" });
/** The payroll on the person's checking (bank v3). */
export const SAMPLE_EMPLOYER = "BRIGHTLINE CONSULTING";

/* The bureau scores ON the file (inputs, like every other line of a report).
   Low 700s: a 40%-used card and one old late, otherwise clean. */
export const SAMPLE_SCORES = Object.freeze({ EX: 702, EQ: 709, TU: 706 });
const SCORE_MODEL = Object.freeze({
  TU: { modelName: "FICO® Score 9", modelNameType: "00W18" },
  EX: { modelName: "Experian/Fair Isaac Risk Model V9", modelNameType: "F9" },
  EQ: { modelName: "FICO Score 9", modelNameType: "05206" }
});
const SCORE_FACTORS = Object.freeze([
  { scoreFactorCode: "10", scoreFactorText: "RATIO OF BALANCE TO LIMIT ON BANK REVOLVING OR OTHER REV ACCTS TOO HIGH" },
  { scoreFactorCode: "13", scoreFactorText: "TIME SINCE DELINQUENCY IS TOO RECENT OR UNKNOWN" },
  { scoreFactorCode: "32", scoreFactorText: "LACK OF RECENT INSTALLMENT LOAN INFORMATION" },
  { scoreFactorCode: "27", scoreFactorText: "TOO FEW ACCOUNTS CURRENTLY PAID AS AGREED" }
]);

/* The Visa's history on the file (the numbers come from the bank). */
const VISA = Object.freeze({
  creditor: "FIRST PLATYPUS BANK", sub: "283FP07120", openedMonthsAgo: 76, refPrefix: "SAMPLE-FPB-"
});

/* The paid-off car loan. 60 months at 4.49% on $21,500 is $401 a month. The
   one 30-day late was 38 months before the pull, while the loan was open. */
const AUTO = Object.freeze({
  creditor: "TOYOTA MOTOR CREDIT", sub: "621AU00318", ref: "SAMPLE-TOYO-7714",
  high: 21_500, monthlyPayment: 401, termMonths: 60, apr: 4.49,
  openedMonthsAgo: 73, closedMonthsAgo: 13, lateMonthsAgo: 38
});

/* Three hard inquiries, one per bureau, each one tied to something in this
   person's life. */
const INQUIRIES = Object.freeze([
  { creditorName: "AMERICAN EXPRESS", bureau: "EX", monthsAgo: 14, businessType: "Banking", subscriberCode: "877FP00231", why: "the Business Amex application" },
  { creditorName: "FIRST PLATYPUS BANK", bureau: "TU", monthsAgo: 9, businessType: "Banking", subscriberCode: "283FP07120", why: "a credit line increase on the Personal Visa" },
  { creditorName: "JPMCB CARD SERVICES", bureau: "EQ", monthsAgo: 5, businessType: "Banking", subscriberCode: "190FP02874", why: "the Chase Ink application" }
]);

const isoDay = (v) => String(v).slice(0, 10);

/** The same day n months earlier (a 29th-31st is held to the 28th). */
export function monthsBefore(day, n, { firstOfMonth = false } = {}) {
  const d = new Date(`${isoDay(day)}T00:00:00Z`);
  d.setUTCDate(firstOfMonth ? 1 : Math.min(d.getUTCDate(), 28));
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

const wholeDollars = (cents) => {
  if (!Number.isInteger(cents) || cents % 100 !== 0) {
    throw new TypeError(`a bureau reports whole dollars; got ${cents} cents`);
  }
  return String(cents / 100);
};

function visaLine(visa, pullDay) {
  const ref = `${VISA.refPrefix}${visa.mask}`;
  return {
    furnishesTo: BUREAUS,
    vendor: {
      creditorName: VISA.creditor,
      accountIdentifier: ref,
      subscriberCode: VISA.sub,
      borrowerSourceType: "Borrower",
      accountType: "Revolving",
      loanType: "CreditCard",
      businessType: "Banking",
      accountOwnershipType: "Individual",
      accountStatusType: "Open",
      accountOpenedDate: monthsBefore(pullDay, VISA.openedMonthsAgo),
      accountReportedDate: visa.lastActivityOn,
      lastActivityDate: visa.lastActivityOn,
      monthsReviewedCount: String(VISA.openedMonthsAgo),
      derogatoryDataIndicator: false,
      currentRatingType: "AsAgreed",
      currentRatingCode: "C",
      creditLimitAmount: wholeDollars(visa.limitCents),
      currentBalanceAmount: wholeDollars(visa.balanceCents),
      highBalanceAmount: String(Math.ceil(visa.highBalanceCents / 100)),
      pastDueAmount: "0",
      monthlyPaymentAmount: String(Math.ceil(visa.minimumPaymentCents / 100)),
      _30DayLates: "0", _60DayLates: "0", _90DayLates: "0",
      paymentPatternData: "C".repeat(24),
      paymentPatternStartDate: visa.lastActivityOn
    },
    repo: {
      currentBalance: wholeDollars(visa.balanceCents),
      apr: String(visa.aprPct),
      account_ref: ref,
      paymentStatus: "current",
      kind: "revolving"
    }
  };
}

function autoLine(pullDay) {
  const closed = monthsBefore(pullDay, AUTO.closedMonthsAgo);
  const lateMonth = monthsBefore(pullDay, AUTO.lateMonthsAgo, { firstOfMonth: true });
  /* Newest month first, starting at the last report (the month it closed).
     Index k is the month k months before that. */
  const pattern = Array.from({ length: 48 }, (_, k) =>
    (k === AUTO.lateMonthsAgo - AUTO.closedMonthsAgo ? "1" : "C")).join("");
  return {
    furnishesTo: BUREAUS,
    vendor: {
      creditorName: AUTO.creditor,
      accountIdentifier: AUTO.ref,
      subscriberCode: AUTO.sub,
      borrowerSourceType: "Borrower",
      accountType: "Installment",
      loanType: "Automobile",
      businessType: "Automotive",
      accountOwnershipType: "Individual",
      accountStatusType: "Closed",
      accountOpenedDate: monthsBefore(pullDay, AUTO.openedMonthsAgo),
      accountClosedDate: closed,
      accountReportedDate: closed,
      lastActivityDate: closed,
      monthsReviewedCount: String(AUTO.termMonths),
      /* The account carries derogatory history: the one late. */
      derogatoryDataIndicator: true,
      currentRatingType: "AsAgreed",
      currentRatingCode: "C",
      highBalanceAmount: String(AUTO.high),
      currentBalanceAmount: "0",
      pastDueAmount: "0",
      monthlyPaymentAmount: String(AUTO.monthlyPayment),
      termsMonthsCount: String(AUTO.termMonths),
      termsDescription: `${AUTO.termMonths} months at $${AUTO.monthlyPayment} per month`,
      _30DayLates: "1", _60DayLates: "0", _90DayLates: "0",
      paymentPatternData: pattern,
      paymentPatternStartDate: closed,
      adverseRatings: {
        highestAdverseRatingDate: lateMonth,
        highestAdverseRatingCode: "1",
        highestAdverseRatingType: "Late30Days",
        mostRecentAdverseRatingDate: lateMonth,
        mostRecentAdverseRatingCode: "1",
        mostRecentAdverseRatingType: "Late30Days",
        priorAdverseRatings: [
          { priorAdverseRatingDate: lateMonth, priorAdverseRatingCode: "1", priorAdverseRatingType: "Late30Days" }
        ]
      },
      comments: [{
        commentSourceType: "CreditBureau",
        commentType: "BureauRemarks",
        commentText: "CLOSED OR PAID ACCOUNT/ZERO BALANCE"
      }]
    },
    repo: {
      currentBalance: "0",
      apr: String(AUTO.apr),
      account_ref: AUTO.ref,
      paymentStatus: "paid as agreed",
      kind: "installment"
    }
  };
}

function scoresFor(code) {
  const model = SCORE_MODEL[code];
  const fico = {
    borrowerSourceType: "Borrower",
    modelName: model.modelName,
    modelNameType: model.modelNameType,
    sourceType: BUREAU_NAME[code],
    factaInquiriesIndicator: true,
    scoreValue: String(SAMPLE_SCORES[code]),
    scoreMaximumValue: "850",
    scoreMinimumValue: "300",
    scoreFactors: SCORE_FACTORS.map((f) => ({ ...f }))
  };
  return [fico];
}

function addressRecord(a, reportedOn) {
  return {
    borrowerResidencyType: "Current",
    addressLine1: String(a.line1).toUpperCase(),
    city: String(a.city).toUpperCase(),
    state: String(a.state).toUpperCase(),
    postalCode: String(a.postal_code),
    dateReported: reportedOn
  };
}

/**
 * buildSampleCreditFile({ pulledAt, person, visa }) → { payload, counts }
 *
 * @param {string} pulledAt  ISO instant the file is "pulled" (the run's clock)
 * @param {object} person    { first, last } off the client row
 * @param {object} visa      the Personal Visa as the bank holds it:
 *   { mask, balanceCents, limitCents, aprPct, minimumPaymentCents,
 *     highBalanceCents, lastActivityOn }
 *
 * counts — the numbers the UnderwriteIQ adapter reads off the client
 * (src/underwrite/adapter.mjs: crs_inquiries_ex/eq/tu,
 * crs_negative_items_count, crs_late_payments_count), COUNTED FROM THIS FILE,
 * the way scripts/sim/push-credit.mjs counts them for its files.
 */
export function buildSampleCreditFile({ pulledAt, person, visa } = {}) {
  if (!pulledAt) throw new TypeError("pulledAt is required");
  if (!person?.first || !person?.last) throw new TypeError("person.first and person.last are required");
  for (const k of ["mask", "balanceCents", "limitCents", "aprPct", "minimumPaymentCents", "highBalanceCents", "lastActivityOn"]) {
    if (visa?.[k] === undefined || visa?.[k] === null) throw new TypeError(`visa.${k} is required`);
  }
  const pullDay = isoDay(pulledAt);
  const lines = [visaLine(visa, pullDay), autoLine(pullDay)];
  const inquiries = INQUIRIES.map((i) => ({ ...i, date: monthsBefore(pullDay, i.monthsAgo) }));
  const submitted = { first: String(person.first).trim(), last: String(person.last).trim() };
  const home = addressRecord(SAMPLE_HOME, monthsBefore(pullDay, 1));

  const bureauReport = (code) => ({
    requestData: {
      firstName: submitted.first.toUpperCase(),
      middleName: "",
      lastName: submitted.last.toUpperCase(),
      suffix: "",
      addresses: [{ ...home }]
    },
    repositoryIncluded: { transunion: code === "TU", experian: code === "EX", equifax: code === "EQ" },
    responseDetail: {
      dateRequested: pulledAt,
      requestingParty: { name: `FUNDHUB — ${SAMPLE_NOTICE}` },
      creditBureauContact: {
        name: "CREDIT REPORTING SERVICES, INC",
        address: { addressLine1: "1024 IRON POINT ROAD", city: "FOLSOM", state: "CA", postalCode: "95630" }
      }
    },
    responseAlertMessages: [],
    creditFiles: [{
      creditFileDetail: {
        borrowerSourceType: "Borrower",
        sourceType: BUREAU_NAME[code],
        creditFileResultStatusType: "FileReturned",
        creditFileInfileDate: pullDay
      },
      aliases: [{ firstName: submitted.first.toUpperCase(), middleName: null, lastName: submitted.last.toUpperCase() }],
      addresses: [{ ...home }],
      employments: [{
        employerName: SAMPLE_EMPLOYER,
        employmentStatusType: "Current",
        employmentStartDate: monthsBefore(pullDay, 40, { firstOfMonth: true }),
        employmentReportedDate: monthsBefore(pullDay, 2, { firstOfMonth: true })
      }]
    }],
    inquiries: inquiries.filter((i) => i.bureau === code).map((i) => ({
      creditorName: i.creditorName,
      borrowerSourceType: "Borrower",
      inquiryDate: i.date,
      businessType: i.businessType,
      subscriberCode: i.subscriberCode,
      sourceType: BUREAU_NAME[code]
    })),
    tradelines: lines.filter((l) => l.furnishesTo.includes(code)).map((l) => ({ ...l.vendor, sourceType: BUREAU_NAME[code] })),
    publicRecords: [],
    scores: scoresFor(code)
  });

  /* Card use: open revolving balance over open revolving limit, one decimal —
     the same rounding the Overview shows a card's used % in. */
  const open = lines.filter((l) => l.vendor.accountType === "Revolving" && l.vendor.accountStatusType === "Open");
  const bal = open.reduce((n, l) => n + Number(l.vendor.currentBalanceAmount), 0);
  const lim = open.reduce((n, l) => n + Number(l.vendor.creditLimitAmount), 0);
  const utilization = lim > 0 ? Math.round((bal / lim) * 1000) / 10 : null;

  const scores = { ex: SAMPLE_SCORES.EX, eq: SAMPLE_SCORES.EQ, tu: SAMPLE_SCORES.TU };
  const payload = {
    source: "crs",
    product: "prequal-fico9",
    environment: "simulated",
    simulated: true,
    simulatedNotice: SAMPLE_NOTICE,
    sampleOf: {
      client: "FinanceOS test client",
      bank: "Plaid sandbox bank v3 (src/banking/plaid-sandbox-user.mjs)",
      built_by: "scripts/finance-os-sample-v3.mjs (src/finance/sample-credit-file.mjs)"
    },
    pulledAt,
    bureausPulled: ["TU", "EX", "EQ"],
    bureaus_pulled: "TU/EX/EQ",
    scores,
    scoreModels: { ex: SCORE_MODEL.EX.modelName, eq: SCORE_MODEL.EQ.modelName, tu: SCORE_MODEL.TU.modelName },
    /* One row per account (the ingests read this list); the bureau copies stay
       under `bureaus`, each carrying the same accountIdentifier. */
    tradelines: lines.map((l) => {
      const code = l.furnishesTo[0];
      return { ...l.vendor, ...l.repo, bureau: code, sourceType: BUREAU_NAME[code] };
    }),
    inquiries: inquiries.map((i) => ({
      creditorName: i.creditorName,
      sourceType: BUREAU_NAME[i.bureau],
      inquiryDate: i.date,
      businessType: i.businessType,
      subscriberCode: i.subscriberCode,
      source: i.bureau,
      date: i.date
    })),
    publicRecords: [],
    utilization,
    bureaus: { TU: bureauReport("TU"), EX: bureauReport("EX"), EQ: bureauReport("EQ") },
    bureauErrors: {},
    bureauStatus: { TU: "file_returned", EX: "file_returned", EQ: "file_returned" },
    requestIds: { ...SAMPLE_REQUEST_IDS }
  };

  const byBureau = (code) => inquiries.filter((i) => i.bureau === code).length;
  const counts = {
    inquiries: { EX: byBureau("EX"), EQ: byBureau("EQ"), TU: byBureau("TU") },
    negativeItems: lines.filter((l) => l.vendor.derogatoryDataIndicator === true).length,
    latePayments: lines.reduce((n, l) => n + Number(l.vendor._30DayLates) + Number(l.vendor._60DayLates) + Number(l.vendor._90DayLates), 0),
    utilizationPct: utilization
  };
  return { payload, counts };
}

/** The custom fields UnderwriteIQ reads, from counts. */
export function countFields(counts) {
  return {
    crs_inquiries_ex: counts.inquiries.EX,
    crs_inquiries_eq: counts.inquiries.EQ,
    crs_inquiries_tu: counts.inquiries.TU,
    crs_negative_items_count: counts.negativeItems,
    crs_late_payments_count: counts.latePayments
  };
}

/**
 * withEngineResult(payload, { submittedName, submittedAddress, email }) →
 *   { payload, outcomeTier, fundingEstimate }
 *
 * Runs the file through the same two calls finishStored() makes after a
 * bureau answers, and keeps what the engine printed on the payload the way
 * scripts/sim/push-credit.mjs keeps it (outcome, preapprovals, reason codes,
 * the engine's own consumer signals) plus `fundingEstimate`, the stored
 * pull's own estimate that src/finance/bank-strategy.mjs fundingEstimate()
 * falls back to. Nothing here is typed in.
 */
export function withEngineResult(payload, { submittedName, submittedAddress = "", email = null } = {}, {
  runTierEngine = runTierEngineFromCrsResult
} = {}) {
  const tierOpts = {
    submittedName,
    submittedAddress,
    formData: { name: submittedName || null, email: email || null, phone: null }
  };
  const { tierResult, fundingEstimate } = scoreBuyerTotal(runTierEngine, payload, tierOpts);
  return {
    payload: {
      ...payload,
      outcome: tierResult.outcome,
      preapprovals: tierResult.preapprovals ?? null,
      reason_codes: tierResult.reasonCodes ?? tierResult.reason_codes ?? [],
      consumerSignals: tierResult.consumerSignals ?? null,
      fundingEstimate: Number.isFinite(fundingEstimate) ? fundingEstimate : null
    },
    outcomeTier: tierResult.outcome,
    fundingEstimate: Number.isFinite(fundingEstimate) ? fundingEstimate : null
  };
}

export const SAMPLE_INQUIRIES = INQUIRIES;
export const SAMPLE_AUTO_LOAN = AUTO;
export default { buildSampleCreditFile, withEngineResult, countFields, SAMPLE_NOTICE, SAMPLE_REQUEST_IDS };
