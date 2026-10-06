// offerFacts(offerKey) — what the marketing machine may say about an offer.
//
// A funnel row (marketing_funnels.offer_key, migration 410) names its offer by
// key. This file turns that key into the few facts a script or a screen needs:
// its label, its price in integer cents, and whether it is sold on a booked call.
//
// NO PRICE IS WRITTEN HERE. Each price is read from the one file that already
// owns it, so a price change there changes it here too:
//   slo_roadmap  → SLO_PRICE_CENTS        (src/slo/offer.mjs)
//   funding_dfy  → OFFERS.FUNDING_DFY      (src/config/offers.mjs)
// src/marketing/offer-facts.test.mjs fails if a literal price shows up in
// src/marketing/.
//
// The two keys are plan-chosen (the spec names the column, not the values) and
// match db/seed/297_marketing_funnels.sql. An unknown key is null — never a
// guess. A price that is not a whole number of cents is null (unknown), never 0.

import { SLO_PRICE_CENTS } from "../slo/offer.mjs";
import { OFFERS } from "../config/offers.mjs";

/** @typedef {{ key: string, label: string, price_cents: number|null, book_call: boolean, source: string }} OfferFacts */

const cents = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/* A null-prototype map, so offerFacts("toString") or "__proto__" is null too. */
const FACTS = Object.freeze(Object.assign(Object.create(null), {
  /* The roadmap, bought on its own page (pay, then pull, then pack, then book).
     The call comes after the sale, so it is not sold on a call. */
  slo_roadmap: () => ({
    key: "slo_roadmap",
    label: "Roadmap",
    price_cents: cents(SLO_PRICE_CENTS),
    book_call: false,
    source: "src/slo/offer.mjs SLO_PRICE_CENTS"
  }),
  /* Funding, done for you. Sold on a booked call; priceCents is the amount the
     pay link charges (the deposit), plus a success fee that is not a price. */
  funding_dfy: () => ({
    key: "funding_dfy",
    label: OFFERS.FUNDING_DFY.name,
    price_cents: cents(OFFERS.FUNDING_DFY.priceCents),
    book_call: true,
    source: "src/config/offers.mjs OFFERS.FUNDING_DFY"
  })
}));

/** Every offer key a funnel may name. */
export const OFFER_KEYS = Object.freeze(Object.keys(FACTS));

/** True when offerFacts(key) would answer. */
export function isOfferKey(key) {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(FACTS, key);
}

/**
 * @param {string} offerKey
 * @returns {OfferFacts|null}
 */
export function offerFacts(offerKey) {
  return isOfferKey(offerKey) ? FACTS[offerKey]() : null;
}
