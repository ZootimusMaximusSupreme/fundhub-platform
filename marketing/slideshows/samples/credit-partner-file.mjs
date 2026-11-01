// The credit-partner sample for the sales slideshows (credit-partner.html, CP-03).
// TWO people, ONE file each: an owner whose own file holds the funding down, and
// a spouse with good credit who joins the Capital Blueprint as the credit partner
// (src/blueprint/credit-partner.mjs). One story, two files that agree with it
// (.ai/rules/sample-clients-consistent.md).
//
// SIMULATED. No credit bureau was contacted. Nobody's real file is in here. The
// names, the address and every account, balance, limit, score and inquiry below
// are design inputs for a sample, not a pull. Every report carries the stamp
// (SAMPLE_NOTICE) and the top level says environment "simulated", the same marks
// marketing/slideshows/samples/red-flag-file.mjs uses.
//
// WHY THIS FILE EXISTS. The CP-03 slide showed three blank boxes (your amount +
// your partner's amount = your total), so the deck's one claim never showed.
// Chris, 2026-10-31: every compare is drastic and comes out of the real engine.
// This file never decides a figure. run-credit-partner-file.mjs runs each file
// through the real UnderwriteIQ engine, the way the product does after a pull,
// stores each figure in the field the product stores it in, and adds the two
// with the product's own rule (combinedPrequalAmount).
//
// THE OWNER, Casey Reed (made up). Scores in the 640s, a Blueprint and Repair
// lane file (under 700). Two cards run up to 86% of their limits, a $4,000 card
// and a $2,500 card, and one collection a debt buyer reports to Equifax and
// TransUnion. Experian has no collection on it, so one bureau is clean.
//
// THE PARTNER, Jordan Reed (made up), the owner's spouse. Scores in the 740s,
// three cards used about 6% in total, the oldest open since 2013, and a car
// loan paid off in full. No late payment, collection or charge-off anywhere.
//
// SHAPE. The vendor's own field names per bureau, the way red-flag-file.mjs and
// scripts/sim/push-credit.mjs build a file. A collection carries the vendor's
// CollectionAgencyAttorney loan type and its adverse ratings, which is what the
// engine counts collections from (push-credit.mjs RATING.collection). No Social
// Security number and no date of birth anywhere.
//
// Pure. No clock, no network, no database. Every date is written out below.

export const SAMPLE_NOTICE =
  "SIMULATED — Fundhub slideshow sample (credit-partner pair). No credit bureau was contacted.";

/** The day both files are "pulled". Every date below is set against it. */
export const PULLED_AT = "2026-10-30T16:00:00.000Z";
const PULL_DAY = PULLED_AT.slice(0, 10);
/** A live account is reported within the last month (scripts/sim/push-credit.mjs). */
const REPORTED_ON = "2026-10-24";

const BUREAUS = Object.freeze(["EX", "EQ", "TU"]);
const BUREAU_NAME = Object.freeze({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" });
const SCORE_MODEL = Object.freeze({
  TU: { modelName: "FICO® Score 9", modelNameType: "00W18" },
  EX: { modelName: "Experian/Fair Isaac Risk Model V9", modelNameType: "F9" },
  EQ: { modelName: "FICO Score 9", modelNameType: "05206" }
});

const HOME = Object.freeze({ line1: "512 SAMPLE AVE", city: "MESA", state: "AZ", postal_code: "85203" });
const HOME_LINE = "512 Sample Ave, Mesa, AZ 85203";

export const OWNER = Object.freeze({
  role: "owner",
  first: "CASEY",
  last: "REED",
  name: "Casey Reed",
  address: HOME,
  addressLine: HOME_LINE,
  employer: "SAMPLE EMPLOYER CO",
  scores: Object.freeze({ EX: 648, EQ: 641, TU: 655 }),
  /* Verbatim reason lines from the vendor sandbox reports, as red-flag-file.mjs
     uses them. Display only; the engine does not read them. */
  factors: Object.freeze([
    { scoreFactorCode: "10", scoreFactorText: "RATIO OF BALANCE TO LIMIT ON BANK REVOLVING OR OTHER REV ACCTS TOO HIGH" },
    { scoreFactorCode: "5", scoreFactorText: "TOO MANY ACCOUNTS WITH BALANCES" }
  ]),
  cards: Object.freeze([
    { creditor: "CAPITAL ONE", sub: "106CO00731", ref: "SAMPLE-CAP1-3127", opened: "2017-05-12", limit: 4_000, balance: 3_450 },
    { creditor: "DISCOVERCARD", sub: "461DC02210", ref: "SAMPLE-DISC-8834", opened: "2019-09-03", limit: 2_500, balance: 2_150 }
  ]),
  loans: Object.freeze([]),
  collections: Object.freeze([
    { creditor: "MIDLAND CREDIT MGMT", sub: "512VS00471", ref: "SAMPLE-MCM-5406", opened: "2025-03-01", balance: 1_240, bureaus: ["EQ", "TU"] }
  ]),
  inquiries: Object.freeze([
    { creditorName: "BARCLAYS BANK DELAWARE", bureau: "EX", date: "2026-06-11", businessType: "Banking", subscriberCode: "302BB01976", why: "a credit card application, declined" }
  ])
});

export const PARTNER = Object.freeze({
  role: "partner",
  first: "JORDAN",
  last: "REED",
  name: "Jordan Reed",
  address: HOME,
  addressLine: HOME_LINE,
  employer: "SAMPLE HEALTH GROUP",
  scores: Object.freeze({ EX: 748, EQ: 741, TU: 752 }),
  factors: Object.freeze([
    { scoreFactorCode: "5", scoreFactorText: "TOO MANY ACCOUNTS WITH BALANCES" }
  ]),
  cards: Object.freeze([
    { creditor: "AMERICAN EXPRESS", sub: "877AX01452", ref: "SAMPLE-AMEX-6021", opened: "2013-02-11", limit: 25_000, balance: 1_500 },
    { creditor: "JPMCB CARD SERVICES", sub: "190JP03318", ref: "SAMPLE-JPMC-7745", opened: "2016-07-19", limit: 14_000, balance: 900 },
    { creditor: "CITIBANK", sub: "214CB00927", ref: "SAMPLE-CITI-1958", opened: "2018-03-30", limit: 8_000, balance: 400 }
  ]),
  loans: Object.freeze([
    { creditor: "TOYOTA MOTOR CREDIT", sub: "621TM00954", ref: "SAMPLE-TOYO-2290", opened: "2019-04-15", closed: "2024-04-15", high: 32_000, monthlyPayment: 603, termMonths: 60 }
  ]),
  collections: Object.freeze([]),
  inquiries: Object.freeze([
    { creditorName: "JPMCB CARD SERVICES", bureau: "EQ", date: "2026-02-17", businessType: "Banking", subscriberCode: "190JP03318", why: "a credit line increase request on the Chase card" }
  ])
});

/** A card's minimum payment for display: 3% of the balance, $35 floor. */
const minimumPayment = (balance) => (balance > 0 ? Math.max(35, Math.round(balance * 0.03)) : 0);

function cardLine(card) {
  return {
    creditorName: card.creditor,
    accountIdentifier: card.ref,
    subscriberCode: card.sub,
    borrowerSourceType: "Borrower",
    accountType: "Revolving",
    loanType: "CreditCard",
    businessType: "Banking",
    accountOwnershipType: "Individual",
    accountStatusType: "Open",
    accountOpenedDate: card.opened,
    accountReportedDate: REPORTED_ON,
    lastActivityDate: REPORTED_ON,
    monthsReviewedCount: "99",
    derogatoryDataIndicator: false,
    currentRatingType: "AsAgreed",
    currentRatingCode: "C",
    creditLimitAmount: String(card.limit),
    currentBalanceAmount: String(card.balance),
    highBalanceAmount: String(card.balance),
    pastDueAmount: "0",
    monthlyPaymentAmount: String(minimumPayment(card.balance)),
    _30DayLates: "0", _60DayLates: "0", _90DayLates: "0",
    paymentPatternData: "C".repeat(24),
    paymentPatternStartDate: REPORTED_ON
  };
}

function loanLine(a) {
  return {
    creditorName: a.creditor,
    accountIdentifier: a.ref,
    subscriberCode: a.sub,
    borrowerSourceType: "Borrower",
    accountType: "Installment",
    loanType: "Automobile",
    businessType: "Automotive",
    accountOwnershipType: "Individual",
    accountStatusType: "Closed",
    accountOpenedDate: a.opened,
    accountClosedDate: a.closed,
    accountReportedDate: REPORTED_ON,
    lastActivityDate: a.closed,
    monthsReviewedCount: String(a.termMonths),
    derogatoryDataIndicator: false,
    currentRatingType: "AsAgreed",
    currentRatingCode: "C",
    highBalanceAmount: String(a.high),
    currentBalanceAmount: "0",
    pastDueAmount: "0",
    monthlyPaymentAmount: String(a.monthlyPayment),
    termsMonthsCount: String(a.termMonths),
    termsDescription: `${a.termMonths} months at $${a.monthlyPayment} per month`,
    _30DayLates: "0", _60DayLates: "0", _90DayLates: "0",
    paymentPatternData: "C".repeat(48),
    paymentPatternStartDate: a.closed,
    comments: [{ commentSourceType: "CreditBureau", commentType: "BureauRemarks", commentText: "CLOSED OR PAID ACCOUNT/ZERO BALANCE" }]
  };
}

/* The first of each of the last `months` months, newest first (push-credit.mjs adverseRatings). */
function adverseHistory(months) {
  const d = new Date(`${PULL_DAY}T00:00:00Z`);
  const out = [];
  for (let i = 0; i < months; i += 1) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push({ priorAdverseRatingDate: m.toISOString().slice(0, 10), priorAdverseRatingCode: "9", priorAdverseRatingType: "CollectionOrChargeOff" });
  }
  return {
    highestAdverseRatingDate: out[out.length - 1].priorAdverseRatingDate,
    highestAdverseRatingCode: "9",
    highestAdverseRatingType: "CollectionOrChargeOff",
    mostRecentAdverseRatingDate: out[0].priorAdverseRatingDate,
    mostRecentAdverseRatingCode: "9",
    mostRecentAdverseRatingType: "CollectionOrChargeOff",
    priorAdverseRatings: out
  };
}

function collectionLine(c) {
  return {
    creditorName: c.creditor,
    accountIdentifier: c.ref,
    subscriberCode: c.sub,
    borrowerSourceType: "Borrower",
    accountType: "Open",
    loanType: "CollectionAgencyAttorney",
    businessType: "Collection",
    accountOwnershipType: "Individual",
    accountStatusType: "Open",
    accountOpenedDate: c.opened,
    accountReportedDate: REPORTED_ON,
    lastActivityDate: REPORTED_ON,
    monthsReviewedCount: "12",
    derogatoryDataIndicator: true,
    currentRatingType: "CollectionOrChargeOff",
    currentRatingCode: "9",
    currentBalanceAmount: String(c.balance),
    highBalanceAmount: String(c.balance),
    pastDueAmount: "0",
    _30DayLates: "0", _60DayLates: "0", _90DayLates: "0",
    paymentPatternData: "999999999999",
    paymentPatternStartDate: REPORTED_ON,
    adverseRatings: adverseHistory(12),
    comments: [{ commentCode: "CZ", commentSourceType: "CreditBureau", commentType: "BureauRemarks", commentText: "PLACED FOR COLLECTION" }]
  };
}

/**
 * buildPersonFile(person) → that person's merged pull, in the shape
 * crs_results.result holds (the same shape red-flag-file.mjs builds).
 */
export function buildPersonFile(person) {
  const lines = [
    ...person.cards.map((c) => ({ line: cardLine(c), bureaus: BUREAUS })),
    ...person.loans.map((l) => ({ line: loanLine(l), bureaus: BUREAUS })),
    ...person.collections.map((c) => ({ line: collectionLine(c), bureaus: c.bureaus }))
  ];
  const home = {
    borrowerResidencyType: "Current",
    addressLine1: person.address.line1,
    city: person.address.city,
    state: person.address.state,
    postalCode: person.address.postal_code,
    dateReported: "2026-09-30"
  };
  const bureauReport = (code) => ({
    requestData: { firstName: person.first, middleName: "", lastName: person.last, suffix: "", addresses: [{ ...home }] },
    repositoryIncluded: { transunion: code === "TU", experian: code === "EX", equifax: code === "EQ" },
    responseDetail: {
      dateRequested: PULLED_AT,
      requestingParty: { name: `FUNDHUB — ${SAMPLE_NOTICE}` },
      creditBureauContact: {
        name: "CREDIT REPORTING SERVICES, INC",
        address: { addressLine1: "1024 IRON POINT ROAD", city: "FOLSOM", state: "CA", postalCode: "95630" }
      }
    },
    responseAlertMessages: [],
    creditFiles: [{
      creditFileDetail: { borrowerSourceType: "Borrower", sourceType: BUREAU_NAME[code], creditFileResultStatusType: "FileReturned", creditFileInfileDate: PULL_DAY },
      aliases: [{ firstName: person.first, middleName: null, lastName: person.last }],
      addresses: [{ ...home }],
      employments: [{ employerName: person.employer, employmentStatusType: "Current", employmentStartDate: "2018-01-08", employmentReportedDate: "2026-08-01" }]
    }],
    inquiries: person.inquiries.filter((i) => i.bureau === code).map((i) => ({
      creditorName: i.creditorName,
      borrowerSourceType: "Borrower",
      inquiryDate: i.date,
      businessType: i.businessType,
      subscriberCode: i.subscriberCode,
      sourceType: BUREAU_NAME[code]
    })),
    tradelines: lines.filter((l) => l.bureaus.includes(code)).map((l) => ({ ...l.line, sourceType: BUREAU_NAME[code] })),
    publicRecords: [],
    scores: [{
      borrowerSourceType: "Borrower",
      modelName: SCORE_MODEL[code].modelName,
      modelNameType: SCORE_MODEL[code].modelNameType,
      sourceType: BUREAU_NAME[code],
      factaInquiriesIndicator: true,
      scoreValue: String(person.scores[code]),
      scoreMaximumValue: "850",
      scoreMinimumValue: "300",
      scoreFactors: person.factors.map((f) => ({ ...f }))
    }]
  });

  const open = person.cards;
  const bal = open.reduce((n, c) => n + c.balance, 0);
  const lim = open.reduce((n, c) => n + c.limit, 0);

  return {
    source: "crs",
    product: "prequal-fico9",
    environment: "simulated",
    simulated: true,
    simulatedNotice: SAMPLE_NOTICE,
    sampleOf: {
      purpose: `Fundhub sales slideshows: the credit-partner pair (${person.role})`,
      built_by: "marketing/slideshows/samples/credit-partner-file.mjs"
    },
    pulledAt: PULLED_AT,
    bureausPulled: ["TU", "EX", "EQ"],
    bureaus_pulled: "TU/EX/EQ",
    scores: { ex: person.scores.EX, eq: person.scores.EQ, tu: person.scores.TU },
    tradelines: lines.map((l) => ({ ...l.line, bureau: l.bureaus[0], sourceType: BUREAU_NAME[l.bureaus[0]] })),
    inquiries: person.inquiries.map((i) => ({
      creditorName: i.creditorName,
      sourceType: BUREAU_NAME[i.bureau],
      inquiryDate: i.date,
      businessType: i.businessType,
      subscriberCode: i.subscriberCode,
      source: i.bureau,
      date: i.date
    })),
    publicRecords: [],
    utilization: lim > 0 ? Math.round((bal / lim) * 1000) / 10 : null,
    bureaus: Object.fromEntries(BUREAUS.map((code) => [code, bureauReport(code)])),
    bureauErrors: {},
    bureauStatus: { TU: "file_returned", EX: "file_returned", EQ: "file_returned" }
  };
}

export default { buildPersonFile, SAMPLE_NOTICE, PULLED_AT, OWNER, PARTNER };
