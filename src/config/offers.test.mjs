import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFFERS,
  getOffer,
  offerAllowsLetters,
  formatCents,
  offersForClient,
  resolveContractTemplateKey,
  defaultContractValues,
  commasProductTitleFor,
  resolveOfferAmountCents
} from "./offers.mjs";
import { isCommasSafeCopy } from "../payments/commas-safe-copy.mjs";

test("Blueprint resolves only whole-dollar prices within the owner range", () => {
  assert.equal(resolveOfferAmountCents("UWIQ_DELIVERABLES"), 500000);
  assert.equal(OFFERS.UWIQ_DELIVERABLES.priceMinCents, 500000);
  assert.equal(OFFERS.UWIQ_DELIVERABLES.priceMaxCents, 1000000);
  for (const cents of [500000, 750000, 1000000]) {
    assert.equal(resolveOfferAmountCents("UWIQ_DELIVERABLES", cents), cents);
  }
  for (const cents of [499999, 1000001, 750001, 750000.5, "750000", null, NaN, Infinity]) {
    assert.throws(() => resolveOfferAmountCents("UWIQ_DELIVERABLES", cents), /whole-dollar/);
  }
  for (const offer of Object.values(OFFERS).filter((o) => o.key !== "UWIQ_DELIVERABLES")) {
    assert.equal(resolveOfferAmountCents(offer.key), offer.priceCents);
    assert.throws(() => resolveOfferAmountCents(offer.key, offer.priceCents), /Only Capital Blueprint/);
  }
});

test("every offer has a Commas product title with no credit/finance words", () => {
  for (const key of Object.keys(OFFERS)) {
    const o = OFFERS[key];
    assert.ok(o.commasProductTitle, key);
    assert.equal(isCommasSafeCopy(o.commasProductTitle), true, `${key}: ${o.commasProductTitle}`);
    assert.notEqual(o.commasProductTitle, o.name, key);
  }
});

test("commasProductTitleFor resolves from product code and purpose", () => {
  assert.equal(
    commasProductTitleFor({ productCode: "card-stacking-dfy" }),
    "Consulting Services Engagement"
  );
  assert.equal(
    commasProductTitleFor({ purpose: "repair" }),
    "Consulting Services Standard"
  );
  assert.equal(
    commasProductTitleFor({ invoiceId: "inv-1" }),
    "Consulting Services Completion"
  );
});

test("every offer has a name, integer cents, and financing/letters flags", () => {
  for (const key of Object.keys(OFFERS)) {
    const o = OFFERS[key];
    assert.equal(o.key, key);
    assert.ok(o.name);
    assert.equal(Number.isInteger(o.priceCents) && o.priceCents > 0, true, key);
    assert.equal(typeof o.financing, "boolean", key);
    assert.equal(typeof o.letters, "boolean", key);
  }
});

test("soft pull and funding deposit do not offer financing", () => {
  assert.equal(OFFERS.SOFT_PULL.financing, false);
  assert.equal(OFFERS.FUNDING_DFY.financing, false);
  assert.equal(OFFERS.REPAIR_DFY.financing, true);
  assert.equal(OFFERS.REPAIR_TRIAL.financing, true);
  assert.equal(OFFERS.UWIQ_DELIVERABLES.financing, true);
  assert.equal(OFFERS.FUNDING_MASTERY.financing, true);
});

test("letters never fire on the qualified funding offer or the soft pull", () => {
  assert.equal(offerAllowsLetters("FUNDING_DFY"), false);
  assert.equal(offerAllowsLetters("SOFT_PULL"), false);
  assert.equal(offerAllowsLetters("REPAIR_DFY"), true);
  assert.equal(offerAllowsLetters("REPAIR_TRIAL"), true);
  assert.equal(offerAllowsLetters("UWIQ_DELIVERABLES"), true);
  assert.equal(offerAllowsLetters("FUNDING_MASTERY"), false);
  assert.equal(offerAllowsLetters("NOPE"), false);
});

test("changing priceCents in the catalog is what offersForClient returns", () => {
  const row = offersForClient().find((o) => o.key === "REPAIR_TRIAL");
  assert.equal(row.priceCents, OFFERS.REPAIR_TRIAL.priceCents);
  assert.equal(row.priceDisplay, formatCents(OFFERS.REPAIR_TRIAL.priceCents));
});

test("getOffer and formatCents do not invent values", () => {
  assert.equal(getOffer("missing"), null);
  assert.equal(formatCents(null), null);
  assert.equal(formatCents("nope"), null);
  assert.equal(formatCents(3200), "$32");
  assert.equal(formatCents(300000), "$3,000");
});

test("UWIQ deliverables contents are the six named items", () => {
  assert.deepEqual(OFFERS.UWIQ_DELIVERABLES.contents, [
    "Credit Analysis Report",
    "Dispute Letter Pack",
    "Credit Optimization Roadmap",
    "Funding Snapshot",
    "Bank & Lender Match List",
    "How To Use This mini course"
  ]);
});

test("repair and funding offers map to contract template keys", () => {
  assert.equal(OFFERS.REPAIR_TRIAL.contractTemplateKey, "REPAIR-TRIAL-AGREEMENT");
  assert.equal(OFFERS.REPAIR_DFY.contractTemplateKey, "CREDIT-REPAIR-AGREEMENT");
  assert.equal(OFFERS.FUNDING_DFY.contractTemplateKey, "FUNDING-AGREEMENT");
  assert.equal(OFFERS.SOFT_PULL.contractTemplateKey, "SOFT-PULL-CONSENT");
  assert.equal(OFFERS.FUNDING_MASTERY.contractTemplateKey, "FUNDING-MASTERY-AGREEMENT");
  assert.equal(resolveContractTemplateKey({ tier: "FUNDING_PLUS_REPAIR" }), "REPAIR-AND-FUNDING-AGREEMENT");
  assert.equal(resolveContractTemplateKey({ offerKey: "REPAIR_TRIAL" }), "REPAIR-TRIAL-AGREEMENT");
  assert.equal(resolveContractTemplateKey({ offerKey: "FUNDING_MASTERY" }), "FUNDING-MASTERY-AGREEMENT");
  assert.ok(defaultContractValues({ offerKey: "REPAIR_TRIAL" }).trial_fee);
  assert.equal(defaultContractValues({ offerKey: "FUNDING_MASTERY" }).program_fee, "$5,000");
});
