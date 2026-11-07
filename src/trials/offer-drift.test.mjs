// The seam between this unit's numbers and the price catalogue.
//
// src/config/offers.mjs is the single source of prices and it is owned by the
// checkout unit; src/trials/constants.mjs carries the same two numbers so this
// module can be built and tested before those entries land. TWO NUMBERS THAT
// MUST AGREE NEED SOMETHING HOLDING THEM TOGETHER, or they drift and the trial
// charges one price while the page shows another.
//
// So: if offers.mjs has the entry, its price must match. If it does not have it
// yet, that is reported as a pending integration rather than a failure — the
// entry is another unit's to add.

import { test, describe } from "node:test";
import assert from "node:assert";

import { OFFERS } from "../config/offers.mjs";
import { FUNDING_PRODUCT_CODES, REPAIR_PRODUCT_CODES } from "../affiliates/economics.mjs";
import {
  LIVE_TRIAL_OFFER_KEY, LIVE_TRIAL_PRICE_CENTS, LIVE_TRIAL_PRODUCT_CODE,
  PARTNER_ENTRY_OFFER_KEY, PARTNER_ENTRY_PRICE_CENTS, PARTNER_ENTRY_PRODUCT_CODE
} from "./constants.mjs";

describe("prices are integer cents", () => {
  test("$297 and $30,000, as whole cents", () => {
    assert.equal(LIVE_TRIAL_PRICE_CENTS, 29700);
    assert.equal(PARTNER_ENTRY_PRICE_CENTS, 3000000);
    assert.ok(Number.isInteger(LIVE_TRIAL_PRICE_CENTS));
    assert.ok(Number.isInteger(PARTNER_ENTRY_PRICE_CENTS));
  });
});

describe("no drift against the price catalogue", () => {
  test("LIVE_TRIAL matches offers.mjs when that entry exists", () => {
    const offer = OFFERS[LIVE_TRIAL_OFFER_KEY];
    if (!offer) return; // not landed yet — the checkout unit owns that file
    assert.equal(offer.priceCents, LIVE_TRIAL_PRICE_CENTS,
      "offers.mjs and src/trials/constants.mjs disagree on the trial price");
    assert.equal(offer.productCode, LIVE_TRIAL_PRODUCT_CODE);
    // Too small to finance, and it buys no dispute letters.
    assert.equal(offer.financing, false);
    assert.equal(offer.letters, false);
  });

  test("PARTNER_ENTRY matches offers.mjs when that entry exists", () => {
    const offer = OFFERS[PARTNER_ENTRY_OFFER_KEY];
    if (!offer) return;
    assert.equal(offer.priceCents, PARTNER_ENTRY_PRICE_CENTS,
      "offers.mjs and src/trials/constants.mjs disagree on the entry fee");
    assert.equal(offer.productCode, PARTNER_ENTRY_PRODUCT_CODE);
    // Financeable — the entry fee is a payment option question, never a
    // qualification one.
    assert.equal(offer.financing, true);
  });
});

describe("both are e-products and stay 100% FundHub", () => {
  /* Adding either code to these lists would make the trial or the entry fee
     earn an affiliate commission, which contradicts the locked terms: the 50%
     partner share covers funding and repair, and e-products are excluded. */
  test("neither product code earns an affiliate commission", () => {
    for (const code of [LIVE_TRIAL_PRODUCT_CODE, PARTNER_ENTRY_PRODUCT_CODE]) {
      assert.ok(!FUNDING_PRODUCT_CODES.includes(code),
        `${code} must never be in FUNDING_PRODUCT_CODES — it is an e-product`);
      assert.ok(!REPAIR_PRODUCT_CODES.includes(code),
        `${code} must never be in REPAIR_PRODUCT_CODES — it is an e-product`);
    }
  });
});
