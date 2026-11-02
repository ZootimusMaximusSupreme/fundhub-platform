/**
 * Deal Math Calculator — pure, dependency-free ESM module.
 * Answers: "Given approved funding, fee, and down payment, what's the monthly obligation?"
 */

/**
 * Reconcile feePct ↔ feeDollar. Pass one or both; the last explicit one wins.
 * If feeDollar is provided, it takes precedence and feePct is back-calculated.
 * If only feePct is provided, feeDollar is derived from approvedFunding.
 * Returns {feePct, feeDollar} — both always present if approvedFunding is given.
 */
export function reconcileFee({ approvedFunding, feePct = 0.10, feeDollar } = {}) {
  if (approvedFunding == null || approvedFunding === '') {
    return { feePct: null, feeDollar: null };
  }
  if (feeDollar != null && feeDollar !== '') {
    return {
      feeDollar,
      feePct: approvedFunding > 0 ? feeDollar / approvedFunding : null,
    };
  }
  return {
    feePct,
    feeDollar: approvedFunding * feePct,
  };
}

/**
 * Main calculator. All inputs optional except approvedFunding.
 * Any output that depends on a missing required input is null.
 */
export function calcDeal({
  approvedFunding,
  feePct = 0.10,
  feeDollar: feeDollarInput,
  downPayment = 0,
  feeFromProceeds = true,
  pctOn0Intro = 1.0,
  introMonths = 12,
  postIntroApr = 0.249,
  minPaymentPct = 0.02,
  amortApr,
  amortTermMonths,
} = {}) {
  const missing = approvedFunding == null || approvedFunding === '';

  // --- 1. Fee reconciliation ---
  const { feeDollar } = reconcileFee({
    approvedFunding: missing ? null : approvedFunding,
    feePct,
    feeDollar: feeDollarInput,
  });

  // Funding Agreement section 2 credits the deposit once toward the fee.
  // Lifetime net cash subtracts the paid deposit and only the remaining fee.
  // A deposit above the fee does not imply an automatic refund.
  const remainingFee = missing ? null : Math.max(0, feeDollar - downPayment);
  const fromProceeds = missing ? null : (feeFromProceeds ? remainingFee : 0);
  const cashPosition = missing
    ? { netCashToClient: null, fee: null, deposit: null }
    : {
        netCashToClient: approvedFunding - downPayment - remainingFee,
        deposit: downPayment,
        fee: { total: feeDollar, paidDown: feeDollar - fromProceeds, fromProceeds },
      };

  // --- 3. Monthly obligation ---
  const fundingAmount = missing ? null : approvedFunding * pctOn0Intro;

  let introSchedule = null;
  let balanceAtIntroExpiry = null;
  let postIntro = null;
  let cliff = null;

  if (!missing) {
    // Month-by-month intro schedule
    const schedule = [];
    let balance = fundingAmount;
    for (let m = 1; m <= introMonths; m++) {
      const payment = balance * minPaymentPct;
      schedule.push({ month: m, openingBalance: balance, payment: round2(payment) });
      balance = balance - payment;
    }
    balanceAtIntroExpiry = round2(balance);

    introSchedule = {
      month1Payment: schedule[0]?.payment ?? null,
      note: 'Minimum payment steps down each month as balance declines.',
      schedule,
      balanceAtIntroExpiry,
    };

    // Post-intro
    const interestOnlyMonthly = round2(balanceAtIntroExpiry * (postIntroApr / 12));
    postIntro = { interestOnlyMonthly };

    // Cliff detection
    const minPaymentAtExpiry = round2(balanceAtIntroExpiry * minPaymentPct);
    if (interestOnlyMonthly > minPaymentAtExpiry) {
      cliff = {
        triggered: true,
        interest: interestOnlyMonthly,
        minPayment: minPaymentAtExpiry,
        message:
          `Post-intro interest ($${interestOnlyMonthly.toLocaleString()}/mo) exceeds the minimum ` +
          `payment ($${minPaymentAtExpiry.toLocaleString()}/mo). Balance will grow unless ` +
          `refinanced or paid down before month ${introMonths + 1}.`,
      };
    } else {
      cliff = {
        triggered: false,
        interest: interestOnlyMonthly,
        minPayment: minPaymentAtExpiry,
        message: null,
      };
    }
  }

  // --- 4. Amortization (non-intro portion) ---
  const amortFundingAmount = missing ? null : approvedFunding * (1 - pctOn0Intro);
  let amort = null;
  if (!missing) {
    const hasAmortInputs =
      amortApr != null && amortApr !== '' &&
      amortTermMonths != null && amortTermMonths !== '';
    if (hasAmortInputs) {
      const monthlyRate = amortApr / 12;
      const payment =
        monthlyRate === 0
          ? amortFundingAmount / amortTermMonths
          : (amortFundingAmount * monthlyRate * Math.pow(1 + monthlyRate, amortTermMonths)) /
            (Math.pow(1 + monthlyRate, amortTermMonths) - 1);
      amort = {
        fundingAmount: amortFundingAmount,
        monthlyPayment: round2(payment),
        amortApr,
        amortTermMonths,
      };
    } else {
      amort = {
        fundingAmount: amortFundingAmount,
        monthlyPayment: null,
        amortApr: null,
        amortTermMonths: null,
      };
    }
  }

  return {
    cashPosition,
    monthly: missing
      ? null
      : {
          intro: introSchedule,
          postIntro,
          amort,
        },
    cliff,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
