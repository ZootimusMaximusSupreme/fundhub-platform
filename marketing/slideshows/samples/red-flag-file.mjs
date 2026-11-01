// The red-flag sample file for the sales slideshows. ONE person, ONE credit file
// (.ai/rules/sample-clients-consistent.md).
//
// SIMULATED. No credit bureau was contacted. Nobody's real file is in here. The
// name, the address and the employer are made up, and every account, balance,
// limit, score and inquiry below is a design input for a sample, not a pull.
// Every report carries the stamp (SAMPLE_NOTICE) in responseDetail.requestingParty
// and the top level says environment "simulated", the same marks
// src/finance/sample-credit-file.mjs and scripts/sim/push-credit.mjs use.
//
// WHY THIS FILE EXISTS. Chris saw the /roadmap sample ($199,350 today, $221,500
// once fixed) and said a $22,000 difference "is nothing... if you're going to
// show a compare and contrast, it should be drastic." That sample was a clean file
// with cards at 12% to 19%, so the engine had almost nothing to fix. This file is
// a strong file held down by red flags Fundhub really fixes, so the engine itself
// prints the big difference. This file never decides a figure.
// run-red-flag-file.mjs runs it through the real UnderwriteIQ engine
// (vendor/underwriteiq-full/api/lite/crs, the same engine behind the old sample
// and the closer's Present deck) and writes what the engine prints.
//
// WHO THIS IS. Jordan Avery (made up), a W-2 employee in Mesa, Arizona (a
// SAMPLE address). Jordan has no LLC yet. Fourteen years of on-time payments:
// four credit cards opened between 2012 and 2018, and a Toyota loan paid off in
// full in 2024. Not one late payment, collection or charge-off anywhere.
//
// THE RED FLAGS, AND WHY EACH ONE IS THERE.
//   1. Card balances run up to 88% of the limits. Jordan paid for a business
//      start-up out of pocket on the four personal cards. The engine puts 88%
//      in its "critical" band (80% and up), which multiplies the funding amount
//      by 0.4. Because card use is 30% or more, the file also misses the
//      full-funding tier and lands in funding-plus-repair, which multiplies it
//      by 0.6 on top (route-outcome.js isFullFunding, estimate-preapprovals.js). The fix is
//      the plan's own: each card paid down to 10% of its limit
//      (src/waypoints/definitions.mjs PAYDOWN_TARGET_FRACTION).
//   2. Six hard inquiries in seven months. With the cards that full, Jordan
//      applied around to spread the balance out: three cards and two personal
//      loans, all declined, plus one credit line increase request on the
//      Chase card. Five of the six come from companies with no account
//      anywhere on the file. Those five are the ones Fundhub's dispute floor
//      disputes (src/metro2/diy/personal-info-floor.mjs, PI-INQUIRY-UNMATCHED).
//      The Chase one has the Chase card behind it, so it stays. The run script
//      asks that product function which inquiries it disputes. Nothing here
//      decides it.
//
// The scores are inputs, like every other line of a report. The engine does not
// work out a new score, so the fixed-file run keeps these same scores.
// The score factor sentences are copied word for word from the vendor's own
// sandbox reports (vendor/underwriteiq-full/api/lite/crs/sandbox/exp.json and
// efx.json). The engine does not read them. They are only for display.
//
// SHAPE. The vendor's own field names per bureau, the way
// src/finance/sample-credit-file.mjs builds its file: one report per bureau under
// `bureaus`, plus the flat one-row-per-account list. No Social Security number and
// no date of birth anywhere.
//
// Pure. No clock, no network, no database. Every date is written out below.

export const SAMPLE_NOTICE =
  "SIMULATED — Fundhub slideshow sample (red-flag file). No credit bureau was contacted.";

/** The day the file is "pulled". Every date below is set against it. */
export const PULLED_AT = "2026-10-30T16:00:00.000Z";
const PULL_DAY = PULLED_AT.slice(0, 10);
/** A live account is reported within the last month (scripts/sim/push-credit.mjs). */
const REPORTED_ON = "2026-10-24";

export const PERSON = Object.freeze({
  first: "JORDAN",
  last: "AVERY",
  name: "Jordan Avery",
  address: Object.freeze({ line1: "418 SAMPLE ST", city: "MESA", state: "AZ", postal_code: "85201" }),
  addressLine: "418 Sample St, Mesa, AZ 85201",
  employer: "SAMPLE EMPLOYER CO",
  hasLLC: false
});

/* The bureau scores ON the file. Low 700s: fourteen years of on-time payments
   hold every bureau at 700 and up, even with the cards at 88% and six recent
   inquiries pulling them down. Median 706. This is a Funding-lane file (credit
   700 and up). */
export const SCORES = Object.freeze({ TU: 702, EX: 711, EQ: 706 });

const SCORE_MODEL = Object.freeze({
  TU: { modelName: "FICO® Score 9", modelNameType: "00W18" },
  EX: { modelName: "Experian/Fair Isaac Risk Model V9", modelNameType: "F9" },
  EQ: { modelName: "FICO Score 9", modelNameType: "05206" }
});

/* Verbatim from the vendor sandbox reports (codes 10, 5 and 8). Experian words
   code 10 its own way; Equifax's wording is used for TransUnion too. */
const SCORE_FACTORS = Object.freeze({
  EX: [
    { scoreFactorCode: "10", scoreFactorText: "PROPORTION OF BALANCE TO LIMITS ON BANK/NATIONAL REVOLVING OR OTHER REVOLVING ACCOUNTS IS TOO HIGH" },
    { scoreFactorCode: "5", scoreFactorText: "TOO MANY ACCOUNTS WITH BALANCES" },
    { scoreFactorCode: "8", scoreFactorText: "TOO MANY INQUIRIES LAST 12 MONTHS" }
  ],
  EQ: [
    { scoreFactorCode: "10", scoreFactorText: "RATIO OF BALANCE TO LIMIT ON BANK REVOLVING OR OTHER REV ACCTS TOO HIGH" },
    { scoreFactorCode: "5", scoreFactorText: "TOO MANY ACCOUNTS WITH BALANCES" },
    { scoreFactorCode: "8", scoreFactorText: "TOO MANY INQUIRIES LAST 12 MONTHS" }
  ],
  TU: [
    { scoreFactorCode: "10", scoreFactorText: "RATIO OF BALANCE TO LIMIT ON BANK REVOLVING OR OTHER REV ACCTS TOO HIGH" },
    { scoreFactorCode: "5", scoreFactorText: "TOO MANY ACCOUNTS WITH BALANCES" },
    { scoreFactorCode: "8", scoreFactorText: "TOO MANY INQUIRIES LAST 12 MONTHS" }
  ]
});

/* The four cards. All open, all Jordan's own (not authorized user), all opened
   well before 2022 so the engine's 24-month seasoning test reads the same on any
   clock. Balances are TODAY's: about 88% of each limit. Every card furnishes
   to all three bureaus with one account number, so the engine and the client
   report see one account, three copies (black-report-client.mjs F43). */
export const CARDS = Object.freeze([
  { creditor: "AMERICAN EXPRESS", sub: "877AX01452", ref: "SAMPLE-AMEX-4417", opened: "2014-04-18", limit: 20_000, balance: 17_700 },
  { creditor: "JPMCB CARD SERVICES", sub: "190JP03318", ref: "SAMPLE-JPMC-2286", opened: "2016-08-09", limit: 12_000, balance: 10_600 },
  { creditor: "CAPITAL ONE", sub: "106CO00731", ref: "SAMPLE-CAP1-9035", opened: "2012-11-03", limit: 6_000, balance: 5_300 },
  { creditor: "DISCOVERCARD", sub: "461DC02210", ref: "SAMPLE-DISC-6142", opened: "2018-02-21", limit: 4_000, balance: 3_500 }
].map(Object.freeze));

/* The paid-off car loan. $28,000 over 60 months at about 4.9% is $527 a month.
   Paid as agreed, every month, closed at zero. */
export const AUTO_LOAN = Object.freeze({
  creditor: "TOYOTA MOTOR CREDIT", sub: "621TM00954", ref: "SAMPLE-TOYO-5508",
  opened: "2019-06-14", closed: "2024-06-14", high: 28_000, monthlyPayment: 527, termMonths: 60
});

/* Six hard inquiries. `why` is the story. Which ones get disputed is NOT decided
   here: the run script asks the dispute floor. */
export const INQUIRIES = Object.freeze([
  { creditorName: "JPMCB CARD SERVICES", bureau: "EX", date: "2026-03-26", businessType: "Banking", subscriberCode: "190JP03318", why: "a credit line increase request on the Chase card" },
  { creditorName: "BARCLAYS BANK DELAWARE", bureau: "TU", date: "2026-05-19", businessType: "Banking", subscriberCode: "302BB01976", why: "a credit card application, declined" },
  { creditorName: "WELLS FARGO CARD SER", bureau: "EQ", date: "2026-06-23", businessType: "Banking", subscriberCode: "157WF04413", why: "a credit card application, declined" },
  { creditorName: "LIGHTSTREAM", bureau: "EX", date: "2026-07-28", businessType: "Finance", subscriberCode: "2205L00618", why: "a personal loan application, declined" },
  { creditorName: "SOFI LENDING CORP", bureau: "TU", date: "2026-08-25", businessType: "Finance", subscriberCode: "8806S01142", why: "a personal loan application, declined" },
  { creditorName: "GOLDMAN SACHS BANK USA", bureau: "EQ", date: "2026-09-29", businessType: "Banking", subscriberCode: "3301G02287", why: "a credit card application, declined" }
].map(Object.freeze));

const BUREAUS = Object.freeze(["EX", "EQ", "TU"]);
const BUREAU_NAME = Object.freeze({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" });

/** A card's minimum payment for display: 3% of the balance, $35 floor. */
const minimumPayment = (balance) => (balance > 0 ? Math.max(35, Math.round(balance * 0.03)) : 0);

function cardLine(card, balance) {
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
    currentBalanceAmount: String(balance),
    /* The highest balance the card has carried stays on the record after a
       paydown; it is history, not today's balance. */
    highBalanceAmount: String(Math.max(card.balance, balance)),
    pastDueAmount: "0",
    monthlyPaymentAmount: String(minimumPayment(balance)),
    _30DayLates: "0", _60DayLates: "0", _90DayLates: "0",
    paymentPatternData: "C".repeat(24),
    paymentPatternStartDate: REPORTED_ON
  };
}

function autoLine() {
  const a = AUTO_LOAN;
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
    /* A closed account is still furnished (scripts/sim/push-credit.mjs, the
       note on accountReportedDate). */
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
    comments: [{
      commentSourceType: "CreditBureau",
      commentType: "BureauRemarks",
      commentText: "CLOSED OR PAID ACCOUNT/ZERO BALANCE"
    }]
  };
}

function scoresFor(code) {
  const model = SCORE_MODEL[code];
  return [{
    borrowerSourceType: "Borrower",
    modelName: model.modelName,
    modelNameType: model.modelNameType,
    sourceType: BUREAU_NAME[code],
    factaInquiriesIndicator: true,
    scoreValue: String(SCORES[code]),
    scoreMaximumValue: "850",
    scoreMinimumValue: "300",
    scoreFactors: SCORE_FACTORS[code].map((f) => ({ ...f }))
  }];
}

/**
 * buildRedFlagFile({ balances, inquiries }) → the merged pull, in the shape
 * crs_results.result holds (src/finance/crs-map.mjs mergeBureauReports).
 *
 * @param {object} [opts]
 * @param {Record<string, number>} [opts.balances]  card balance by account ref.
 *        Left out, every card carries TODAY's balance. The run script passes the
 *        paid-down balances for the fixed-file run.
 * @param {object[]} [opts.inquiries]  the inquiries on the file. Left out, all six.
 */
export function buildRedFlagFile({ balances = null, inquiries = INQUIRIES } = {}) {
  const balanceOf = (card) => (balances && Number.isFinite(balances[card.ref]) ? balances[card.ref] : card.balance);
  const lines = [...CARDS.map((c) => cardLine(c, balanceOf(c))), autoLine()];
  const home = {
    borrowerResidencyType: "Current",
    addressLine1: PERSON.address.line1,
    city: PERSON.address.city,
    state: PERSON.address.state,
    postalCode: PERSON.address.postal_code,
    dateReported: "2026-09-30"
  };

  const bureauReport = (code) => ({
    requestData: { firstName: PERSON.first, middleName: "", lastName: PERSON.last, suffix: "", addresses: [{ ...home }] },
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
      creditFileDetail: {
        borrowerSourceType: "Borrower",
        sourceType: BUREAU_NAME[code],
        creditFileResultStatusType: "FileReturned",
        creditFileInfileDate: PULL_DAY
      },
      aliases: [{ firstName: PERSON.first, middleName: null, lastName: PERSON.last }],
      addresses: [{ ...home }],
      employments: [{
        employerName: PERSON.employer,
        employmentStatusType: "Current",
        employmentStartDate: "2019-03-01",
        employmentReportedDate: "2026-08-01"
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
    tradelines: lines.map((l) => ({ ...l, sourceType: BUREAU_NAME[code] })),
    publicRecords: [],
    scores: scoresFor(code)
  });

  const open = lines.filter((l) => l.accountType === "Revolving" && l.accountStatusType === "Open");
  const bal = open.reduce((n, l) => n + Number(l.currentBalanceAmount), 0);
  const lim = open.reduce((n, l) => n + Number(l.creditLimitAmount), 0);

  return {
    source: "crs",
    product: "prequal-fico9",
    environment: "simulated",
    simulated: true,
    simulatedNotice: SAMPLE_NOTICE,
    sampleOf: {
      purpose: "Fundhub sales slideshows: the red-flag sample file",
      built_by: "marketing/slideshows/samples/red-flag-file.mjs"
    },
    pulledAt: PULLED_AT,
    bureausPulled: ["TU", "EX", "EQ"],
    bureaus_pulled: "TU/EX/EQ",
    scores: { ex: SCORES.EX, eq: SCORES.EQ, tu: SCORES.TU },
    tradelines: lines.map((l) => ({ ...l, bureau: "EX", sourceType: "Experian" })),
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
    utilization: lim > 0 ? Math.round((bal / lim) * 1000) / 10 : null,
    bureaus: Object.fromEntries(BUREAUS.map((code) => [code, bureauReport(code)])),
    bureauErrors: {},
    bureauStatus: { TU: "file_returned", EX: "file_returned", EQ: "file_returned" }
  };
}

export default { buildRedFlagFile, SAMPLE_NOTICE, PULLED_AT, PERSON, SCORES, CARDS, AUTO_LOAN, INQUIRIES };
