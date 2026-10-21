// ONE COPY (2026-10-20). This file used to be src/waypoints/pricing.mjs. It moved here whole, unchanged except its
// import paths, so the hourly beat client-progress runs the same progress read as GET /api/read/client-progress. A beat may import only from src/pulse/beats/lib.
// src/waypoints/pricing.mjs re-exports everything here, so every caller imports from there as before. Change it here.
//
// COMPLIANCE REVIEW REQUIRED — fee timing. This module prices a self-serve
// dispute round. It charges nobody: it returns line items and a total, and
// something else has to mint a hosted checkout link and record a payment.
//
// Owner-set pricing (2026-09-05), stored as line items rather than as a number
// so a receipt itemises and a later price change does not restate what somebody
// already paid:
//
//   $100 flat per round, covering all three bureaus
//   +$10 when a creditor letter is required
//   +$20 when the CFPB and state attorney general filings are required
//
// Money is integer cents (src/commissions/money.mjs). Nothing here uses floats
// and nothing here rounds, because every price is a whole number of cents.
//
// The CODES are the stable part and the AMOUNTS are not. db/migrations/331
// stores both on the row, checks that the lines sum to the total, and
// deliberately does not CHECK the codes — see that file's header.

/** @typedef {{code:string,label:string,quantity:number,unit_cents:number,amount_cents:number}} PriceLine */

export const ROUND_BASE_CENTS = 10_000;
export const CREDITOR_LETTER_CENTS = 1_000;
export const ESCALATION_FILINGS_CENTS = 2_000;

export const PRICE_CODES = Object.freeze({
  ROUND_BASE: "round_base",
  CREDITOR_LETTER: "creditor_letter",
  ESCALATION_FILINGS: "escalation_filings"
});

function line(code, label, unitCents, quantity = 1) {
  if (!Number.isInteger(unitCents) || unitCents <= 0) {
    throw new TypeError(`price line ${code}: unit_cents must be a positive integer, got ${unitCents}`);
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new TypeError(`price line ${code}: quantity must be a positive integer, got ${quantity}`);
  }
  return {
    code,
    label,
    quantity,
    unit_cents: unitCents,
    amount_cents: unitCents * quantity
  };
}

/**
 * Price one self-serve dispute round.
 *
 * @param {{creditorLetter?: boolean, escalationFilings?: boolean}} [opts]
 *   creditorLetter     — a letter to the furnisher is part of this round.
 *   escalationFilings  — the CFPB and state AG filings are part of this round.
 * @returns {{components: PriceLine[], totalCents: number}}
 */
export function priceDisputeRound({ creditorLetter = false, escalationFilings = false } = {}) {
  const components = [
    line(PRICE_CODES.ROUND_BASE, "Dispute round — all three bureaus", ROUND_BASE_CENTS)
  ];
  if (creditorLetter) {
    components.push(line(PRICE_CODES.CREDITOR_LETTER, "Creditor letter", CREDITOR_LETTER_CENTS));
  }
  if (escalationFilings) {
    components.push(
      line(PRICE_CODES.ESCALATION_FILINGS, "CFPB and state attorney general filings", ESCALATION_FILINGS_CENTS)
    );
  }
  return { components, totalCents: sumComponents(components) };
}

/**
 * Sum line items in integer cents. Mirrors fundhub_price_components_total() in
 * db/migrations/331 — the database is the one that decides, this is here so a
 * caller can build a row the database will accept instead of finding out on the
 * INSERT.
 *
 * Throws rather than returning 0 on a malformed line, because a receipt that
 * quietly sums to less than it should is the failure this whole shape exists to
 * prevent.
 */
export function sumComponents(components) {
  if (!Array.isArray(components)) {
    throw new TypeError("price components must be an array");
  }
  let total = 0;
  for (const c of components) {
    if (!c || typeof c !== "object") throw new TypeError("price component must be an object");
    if (typeof c.code !== "string" || !/[^\s]/.test(c.code)) {
      throw new TypeError("price component needs a non-blank code");
    }
    if (!Number.isInteger(c.amount_cents)) {
      throw new TypeError(`price component ${c.code}: amount_cents must be an integer number of cents`);
    }
    total += c.amount_cents;
  }
  return total;
}
