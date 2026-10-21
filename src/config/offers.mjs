// Closer-deck / CRM offer catalog. Prices, names, and financing flags live HERE.
// Screens read this module (or GET /api/read/closer-deck). Do not hardcode them
// in HTML/JS. Change a number here and it changes everywhere.
//
// Owner-set. Subject to change. COMPLIANCE REVIEW REQUIRED — fee timing.

export const UWIQ_DELIVERABLES_CONTENTS = Object.freeze([
  "Credit Analysis Report",
  "Dispute Letter Pack",
  "Credit Optimization Roadmap",
  "Funding Snapshot",
  "Bank & Lender Match List",
  "How To Use This mini course"
]);

/** @typedef {"SOFT_PULL"|"FUNDING_DFY"|"REPAIR_DFY"|"REPAIR_TRIAL"|"UWIQ_DELIVERABLES"|"FUNDING_MASTERY"} OfferKey */

/**
 * @typedef {object} Offer
 * @property {OfferKey} key
 * @property {string} name
 * @property {number} priceCents  amount charged on the pay link (deposit for FUNDING_DFY)
 * @property {number} [priceMinCents]
 * @property {number} [priceMaxCents]
 * @property {number} [successFeePercent]  10 = 10%
 * @property {boolean} financing  Commas financing offered
 * @property {boolean} letters  DS-02 / letter pack may fire for this offer
 * @property {"diagnostic"|"deposit"|"repair"|"custom"} paymentPurpose
 * @property {string} productCode  products.code; durable identity for payment links
 * @property {string} commasProductTitle  vendor checkout title only — consulting language, no credit/finance
 * @property {string} [contractTemplateKey]  contract_templates.template_key to send on close
 * @property {string[]} [contents]
 */

export const COMMAS_DEFAULT_PRODUCT_TITLE = "Consulting Services Package";

export const COMMAS_INVOICE_PRODUCT_TITLE = "Consulting Services Completion";

const COMMAS_TITLE_BY_PRODUCT_CODE = Object.freeze({
  diagnostic: "Consulting Services Assessment",
  "card-stacking-dfy": "Consulting Services Engagement",
  "consulting-package": "Consulting Services Package",
  /* The $1,000 DIY dispute-letter downsell. It used to share
     'consulting-package' — and therefore this exact vendor title — with the
     $5,000 Capital Blueprint, which is how one payment could never be told from
     the other. db/migrations/384_diy_letter_pack_product.sql gives it its own
     products row; this is its own vendor title, so an unlinked receipt names
     which of the two was bought. Nothing mints a link on it today (there is no
     DIY entry in OFFERS — the DIY invoice is raised by
     src/workflows/ds-02-diy-letters.mjs and sent by hand), so this line is
     inert until a "Consulting Services Letters" product exists in Commas. */
  "diy-letter-pack": "Consulting Services Letters",
  "repair-bundle": "Consulting Services Standard",
  "repair-trial": "Consulting Services Trial",
  "funding-mastery": "Consulting Services Program",
  "inquiry-removal": "Consulting Services Records",
  // The white-label partner add-ons (PARTNER_ADD_ONS below). Listed here as
  // well as on the add-on so a resolve that only knows the product code still
  // lands on the right vendor title.
  "creative-intelligence": "Consulting Services Insights",
  "dfy-marketing": "Consulting Services Retainer",
  "lead-flow": "Consulting Services Introductions"
});

const COMMAS_TITLE_BY_PURPOSE = Object.freeze({
  diagnostic: "Consulting Services Assessment",
  deposit: "Consulting Services Engagement",
  repair: "Consulting Services Standard",
  custom: COMMAS_DEFAULT_PRODUCT_TITLE
});

/** Resolve the Commas-facing product title — never staff free text. */
export function commasProductTitleFor({
  offerKey = null,
  productCode = null,
  purpose = null,
  commasProductTitle = null,
  invoiceId = null
} = {}) {
  if (invoiceId) return COMMAS_INVOICE_PRODUCT_TITLE;
  if (commasProductTitle) return String(commasProductTitle).trim();
  const offer = getOffer(offerKey) || getPartnerAddOn(offerKey);
  if (offer?.commasProductTitle) return offer.commasProductTitle;
  const code = String(productCode || offer?.productCode || "").trim().toLowerCase();
  if (code && COMMAS_TITLE_BY_PRODUCT_CODE[code]) return COMMAS_TITLE_BY_PRODUCT_CODE[code];
  const p = String(purpose || offer?.paymentPurpose || "").trim().toLowerCase();
  if (p && COMMAS_TITLE_BY_PURPOSE[p]) return COMMAS_TITLE_BY_PURPOSE[p];
  return COMMAS_DEFAULT_PRODUCT_TITLE;
}

/** @type {Readonly<Record<OfferKey, Offer>>} */
export const OFFERS = Object.freeze({
  SOFT_PULL: Object.freeze({
    key: "SOFT_PULL",
    name: "UnderwriteIQ soft-pull assessment",
    priceCents: 3200,
    financing: false,
    letters: false,
    paymentPurpose: "diagnostic",
    productCode: "diagnostic",
    commasProductTitle: "Consulting Services Assessment",
    contractTemplateKey: "SOFT-PULL-CONSENT"
  }),
  FUNDING_DFY: Object.freeze({
    key: "FUNDING_DFY",
    name: "Funding, done-for-you",
    priceCents: 300000,
    successFeePercent: 10,
    financing: false,
    letters: false,
    paymentPurpose: "deposit",
    productCode: "card-stacking-dfy",
    commasProductTitle: "Consulting Services Engagement",
    contractTemplateKey: "FUNDING-AGREEMENT"
  }),
  REPAIR_DFY: Object.freeze({
    key: "REPAIR_DFY",
    name: "Credit repair, done-for-you",
    priceCents: 100000,
    financing: true,
    letters: true,
    paymentPurpose: "repair",
    productCode: "repair-bundle",
    commasProductTitle: "Consulting Services Standard",
    contractTemplateKey: "CREDIT-REPAIR-AGREEMENT"
  }),
  REPAIR_TRIAL: Object.freeze({
    key: "REPAIR_TRIAL",
    name: "Repair test run (first round, done for you)",
    priceCents: 20000,
    financing: true,
    letters: true,
    paymentPurpose: "repair",
    productCode: "repair-trial",
    commasProductTitle: "Consulting Services Trial",
    contractTemplateKey: "REPAIR-TRIAL-AGREEMENT"
  }),
  UWIQ_DELIVERABLES: Object.freeze({
    key: "UWIQ_DELIVERABLES",
    name: "Capital Blueprint",
    /* $5,000, OWNER-SET 2026-09-03. It was 100000 ($1,000) and that was the
       number that was wrong, not the contract. Chris's executed Capital
       Blueprint service agreement states its own tuition twice — sections 1.3
       and 5.1, "five thousand United States dollars ($5,000)" — and it was
       seeded verbatim in db/migrations/288_real_contract_text.sql. A contract
       that quotes one figure while the pay link charges another is the defect;
       asked which was right, Chris said the contract. So the catalogue moves.

       KNOWN CONSEQUENCE, not an oversight: FUNDING_MASTERY (Capital Academy) is
       also 500000, so the education ladder now has two rungs at the same price
       and "step down on a no" has nothing to step down to. The deck's ladder
       hint reads that state rather than asserting a drop — see the S-19 block in
       public/app/present.js. Whether Blueprint stays a rung of that ladder is a
       sales question, not a code one, and it is written up in
       ops/workflows/fix-batch-2026-09-03-remaining.md.

       Owner-set 2026-10-20: the closer may choose any whole-dollar price
       from $5,000 through $10,000. The default remains $5,000. */
    priceCents: 500000,
    priceMinCents: 500000,
    priceMaxCents: 1000000,
    financing: true,
    letters: true,
    paymentPurpose: "custom",
    /* 'consulting-package' IS the Capital Blueprint and now ONLY the Capital
       Blueprint. It used to be two products at two prices behind one code: this
       $5,000 offer, and the $1,000 DIY letter downsell that money-chain's
       BUCKET_TO_CODE.diy pointed at. A payment could not say which it was, so a
       $5,000 buyer was granted the DIY letter pack and left locked out of the
       thing he bought (Sim Eleven-Blueprint, 2026-09-17, measured on
       production). The DIY downsell moved to its own product code
       'diy-letter-pack' in db/migrations/384_diy_letter_pack_product.sql.

       Why this offer kept the old code rather than moving: every recorded
       'Consulting Services Package' payment on production is a $5,000 Blueprint,
       products.default_price on this row was moved to $5,000 by
       289_capital_blueprint_price.sql (owner-set), and
       383_blueprint_entitlement.sql already maps it to the roadmap the tile
       gates on. Moving the Blueprint instead would have orphaned the buyer who
       has already paid, and telling his payment from a DIY one would have meant
       reading the dollar amount — which Hard Rule 4 forbids. */
    productCode: "consulting-package",
    commasProductTitle: "Consulting Services Package",
    /* Added 2026-09-03. Capital Blueprint was the ONLY client offer in this
       catalogue with no contract, while the $200 repair trial had one — so a
       Blueprint sale closed with nothing to send, resolveContractTemplateKey()
       returned null, the deck matched no wording, and nothing said so. The
       template is seeded by
       db/migrations/287_contract_seller_signature_and_real_text.sql. */
    contractTemplateKey: "CAPITAL-BLUEPRINT-AGREEMENT",
    contents: UWIQ_DELIVERABLES_CONTENTS
  }),
  FUNDING_MASTERY: Object.freeze({
    key: "FUNDING_MASTERY",
    name: "Capital Academy",
    priceCents: 500000,
    financing: true,
    letters: false,
    paymentPurpose: "custom",
    productCode: "funding-mastery",
    commasProductTitle: "Consulting Services Program",
    contractTemplateKey: "FUNDING-MASTERY-AGREEMENT"
  }),

  /* The three self-serve doors on the partner funnel, plus the entry fee.
     These landed after the units that needed them: src/trials/constants.mjs and
     api/public/funnel-checkout.mjs each carried their own copy so they could be
     built before this catalogue caught up, and each holds a drift test that
     fails if the number here disagrees. This is now the source; those tests are
     what keep it the only one.

     All four are E-PRODUCTS. Per W0-decisions.md the 50% partner share covers
     funding and repair only, so none of these product codes may ever appear in
     FUNDING_PRODUCT_CODES or REPAIR_PRODUCT_CODES. */

  DECLINE_AUTOPSY: Object.freeze({
    key: "DECLINE_AUTOPSY",
    name: "Decline Autopsy",
    priceCents: 2700,
    financing: false,
    letters: false,
    paymentPurpose: "custom",
    productCode: "decline-autopsy",
    commasProductTitle: "Consulting Services Assessment"
  }),

  WINNERS_BOARD: Object.freeze({
    key: "WINNERS_BOARD",
    name: "Winner's Board",
    priceCents: 4700,
    financing: false,
    letters: false,
    paymentPurpose: "custom",
    productCode: "winners-board",
    commasProductTitle: "Consulting Services Insights"
  }),

  LIVE_TRIAL: Object.freeze({
    key: "LIVE_TRIAL",
    name: "Live Trial — seven days under your brand",
    priceCents: 29700,
    financing: false,
    letters: false,
    paymentPurpose: "custom",
    productCode: "live-trial",
    commasProductTitle: "Consulting Services Trial"
  }),

  /* Financeable, because price is a payment question and never a qualification
     one — the review call decides who becomes a partner, not a lender. */
  PARTNER_ENTRY: Object.freeze({
    key: "PARTNER_ENTRY",
    name: "White-label partner program",
    priceCents: 1000000,
    financing: true,
    letters: false,
    paymentPurpose: "custom",
    productCode: "partner-entry",
    commasProductTitle: "Consulting Services Program"
  })
});

export const OFFER_KEYS = Object.freeze(Object.keys(OFFERS));

// ───────────────────────────────────────────────────────────────────────────
// THE WHITE-LABEL PARTNER ADD-ON MENU (docs/specs/W6-pricing-menu.md).
// Owner-set 2026-08-31. COMPLIANCE REVIEW REQUIRED — recurring fee timing.
//
// A partner pays $10,000 once to join and nothing monthly. These three are the
// menu on top of that: stack freely, cancel freely, none a prerequisite for
// another. The 50/50 split never moves for any of them.
//
// WHY THESE ARE NOT IN `OFFERS`, AND WHY THAT IS NOT A STYLE CHOICE. `OFFERS`
// is the CLIENT catalogue — line 1 of this file calls it the closer-deck
// catalog, src/sales/closer-deck.mjs feeds every entry of it to the client
// present page through offersForClient(), sendDeckPayLink() will build a
// client pay link for any key in it, and api/pipeline-clients.mjs accepts any
// productCode in it as a product to put a CLIENT on a board. Dropping three
// partner-only add-ons in there would offer a client "Done-For-You Marketing,
// $2,497/month" on the deck. Same shape, same Object.freeze, same integer
// cents, same commasProductTitleFor resolution — separate map, because the
// audience is different.
//
// THE SHAPE GAINS ONE FIELD THE Offer SHAPE HAS NO WAY TO SAY: `billing`.
// Every existing Offer is a single charge on a pay link, so nothing in the
// Offer typedef can express "every month" or "each time one is delivered".
// `billing` says which, and `unitLabel` says what one unit is when the answer
// is per_unit. priceCents stays what it is everywhere else — integer cents for
// ONE billing unit. Nothing existing was bent to fit.
//
// `financing` IS DELIBERATELY ABSENT. Whether FundHub finances a monthly
// add-on the way it finances the $10,000 entry is an owner decision nobody has
// made. Absent means not recorded. It is not false.
//
// NONE OF THESE EVER PAYS A PARTNER. They are FundHub revenue: `partnerShare`
// is false on all three, their products.code must never join the partner
// accrual allow-list W1-money-model.md §7 specifies, and no partner_revenue
// row may be written for one. src/config/partner-add-ons.test.mjs holds that.
// ───────────────────────────────────────────────────────────────────────────

/** @typedef {"CREATIVE_INTELLIGENCE"|"DFY_MARKETING"|"LEAD_FLOW"} PartnerAddOnKey */

/**
 * @typedef {object} PartnerAddOn
 * @property {PartnerAddOnKey} key
 * @property {string} name
 * @property {number} priceCents  integer cents for ONE billing unit
 * @property {"monthly"|"per_unit"} billing  how often priceCents is charged
 * @property {string|null} unitLabel  what one unit is, when billing is per_unit
 * @property {"partner"} audience  sold to a partner, never to a client
 * @property {boolean} partnerShare  false: FundHub revenue, never a partner_revenue row
 * @property {boolean} letters  DS-02 / letter pack may never fire for these
 * @property {string} productCode  products.code (db/migrations/271), and the
 *   `tier` written on the partner's `subscriptions` row
 * @property {string} commasProductTitle  vendor checkout title only
 * @property {string} summary  one plain line, for a menu screen
 */

/** @type {Readonly<Record<PartnerAddOnKey, PartnerAddOn>>} */
export const PARTNER_ADD_ONS = Object.freeze({
  CREATIVE_INTELLIGENCE: Object.freeze({
    key: "CREATIVE_INTELLIGENCE",
    name: "Creative Intelligence",
    priceCents: 29700,
    billing: "monthly",
    unitLabel: null,
    audience: "partner",
    partnerShare: false,
    letters: false,
    productCode: "creative-intelligence",
    commasProductTitle: "Consulting Services Insights",
    summary:
      "Hooks written for their offer, their own segment so partners never bid against each other, the Winner's Board, and their numbers read back to them."
  }),
  DFY_MARKETING: Object.freeze({
    key: "DFY_MARKETING",
    name: "Done-For-You Marketing",
    priceCents: 249700,
    billing: "monthly",
    unitLabel: null,
    audience: "partner",
    partnerShare: false,
    letters: false,
    productCode: "dfy-marketing",
    commasProductTitle: "Consulting Services Retainer",
    // The partner's own ad spend is theirs and never lands on FundHub's books,
    // so it is not a price here and must not be added to one.
    summary:
      "FundHub builds the creative, runs the campaigns and manages the ad account. The partner still pays for their own ads on top."
  }),
  LEAD_FLOW: Object.freeze({
    key: "LEAD_FLOW",
    name: "Lead Flow",
    priceCents: 9900,
    billing: "per_unit",
    unitLabel: "booked call",
    audience: "partner",
    partnerShare: false,
    letters: false,
    productCode: "lead-flow",
    commasProductTitle: "Consulting Services Introductions",
    summary:
      "Booked, screened calls with business owners handed straight to the partner."
  })
});

export const PARTNER_ADD_ON_KEYS = Object.freeze(Object.keys(PARTNER_ADD_ONS));

/** One add-on by key, or null. Deliberately separate from getOffer(): a client
 *  offer and a partner add-on must never resolve through the same door. */
export function getPartnerAddOn(key) {
  if (!key) return null;
  return PARTNER_ADD_ONS[String(key)] || null;
}

/** "$297/month" · "$99 per booked call". Composed, never a second copy of a
 *  price. Returns null when the price is not a number rather than inventing a
 *  free one. */
export function partnerAddOnPriceLabel(addOn) {
  const a = typeof addOn === "string" ? getPartnerAddOn(addOn) : addOn;
  const price = formatCents(a && a.priceCents);
  if (!price) return null;
  if (a.billing === "per_unit") {
    return a.unitLabel ? `${price} per ${a.unitLabel}` : `${price} per unit`;
  }
  if (a.billing === "monthly") return `${price}/month`;
  return price;
}

/** The menu, as JSON a partner screen can render. No internals. */
export function partnerAddOnsForMenu() {
  return PARTNER_ADD_ON_KEYS.map((k) => {
    const a = PARTNER_ADD_ONS[k];
    return {
      key: a.key,
      name: a.name,
      summary: a.summary,
      priceCents: a.priceCents,
      priceDisplay: formatCents(a.priceCents),
      priceLabel: partnerAddOnPriceLabel(a),
      billing: a.billing,
      unitLabel: a.unitLabel,
      productCode: a.productCode
    };
  });
}

export function getOffer(key) {
  if (!key) return null;
  return OFFERS[String(key)] || null;
}

/** Resolve the exact closer price before any checkout or agreement is made. */
export function resolveOfferAmountCents(offerKey, amountCents = undefined) {
  const offer = getOffer(offerKey);
  if (!offer) throw new RangeError("Unknown offer.");
  if (amountCents === undefined) return offer.priceCents;
  if (offer.key !== "UWIQ_DELIVERABLES") {
    throw new RangeError("Only Capital Blueprint accepts a custom price.");
  }
  if (!Number.isSafeInteger(amountCents) || amountCents % 100 !== 0
      || amountCents < offer.priceMinCents || amountCents > offer.priceMaxCents) {
    throw new RangeError("Choose a whole-dollar Capital Blueprint price from $5,000 to $10,000.");
  }
  return amountCents;
}

export function offerAllowsLetters(key) {
  const o = getOffer(key);
  return !!(o && o.letters);
}

export function formatCents(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  return (Number(cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

/** Which contract wording matches the deck path (offer + tier).
 *  The combined agreement is for the funding sale only (or a caller that knows
 *  just the tier). Any other offer on a funding-plus-repair deck keeps its own
 *  agreement, so a Blueprint buyer gets CAPITAL-BLUEPRINT-AGREEMENT — the
 *  wording that matches the pay link. public/app/present.js mirrors this;
 *  src/http/present-contract-pick.test.mjs fails if the two drift. */
export function resolveContractTemplateKey({ offerKey = null, tier = null } = {}) {
  if (tier === "FUNDING_PLUS_REPAIR" && (!offerKey || offerKey === "FUNDING_DFY")) {
    return "REPAIR-AND-FUNDING-AGREEMENT";
  }
  const o = getOffer(offerKey);
  return (o && o.contractTemplateKey) || null;
}

/**
 * OFFER_KEY_BY_TEMPLATE_KEY — the catalogue read backwards.
 *
 * defaultContractValues() is now called from two directions. The deck knows the
 * OFFER and asks what to fill in; src/contracts/send.mjs holds a draft that
 * knows only its TEMPLATE KEY (contracts.template_key) and asks the same thing.
 * Without this map the second caller would have to carry its own copy of the
 * prices, which is the duplicate-source arrangement that produced the
 * $1,000-a-month repair defect. Built from OFFERS so it cannot drift from it.
 *
 * REPAIR-AND-FUNDING-AGREEMENT is absent on purpose: it is reached by TIER, not
 * by any single offer, and its branch below reads both offers directly.
 */
const OFFER_KEY_BY_TEMPLATE_KEY = Object.freeze(
  OFFER_KEYS.reduce((acc, k) => {
    const key = OFFERS[k].contractTemplateKey;
    if (key && !acc[key]) acc[key] = k;
    return acc;
  }, {})
);

/**
 * defaultContractValues — every blank a contract needs, filled from the
 * catalogue. NOBODY TYPES THESE.
 *
 * Owner decision 2026-09-03 (F27): the "wording for this client" form comes out
 * of the deck entirely. "It should already have that information. Just send
 * it." So this function is the whole of what a contract's blanks are filled
 * from, and src/contracts/send.mjs applies it at draft time — a send with no
 * typed input at all has to produce a complete document.
 *
 * NO company_name AND NO company_email. That pair used to be here, and a staff
 * member could type over them in the deck; on 2026-09-03 one typed the CLIENT's
 * company into company_name and it rendered as the SELLER — "Between: Sim Five
 * Academy LLC ("we")" on a Fundhub agreement (F28). The seller is Fundhub LLC
 * on every client contract, so it is written into the template's words and is
 * not a value any more. See
 * db/migrations/287_contract_seller_signature_and_real_text.sql.
 *
 * Accepts a templateKey directly for callers that have one and no offer.
 */
export function defaultContractValues({ offerKey = null, tier = null, templateKey = null } = {}) {
  const key = templateKey || resolveContractTemplateKey({ offerKey, tier });
  const o = getOffer(offerKey) || getOffer(OFFER_KEY_BY_TEMPLATE_KEY[key]);
  const price = formatCents(o && o.priceCents);

  if (key === "SOFT-PULL-CONSENT") {
    /* consent_days is DATA, not decoration. src/handlers/contract-consent.mjs
       reads it off merge_values to set when the permission expires and treats an
       absent value as no term at all — a permanent one. It stays a value even
       though nobody types it. */
    return { consent_days: "90" };
  }
  if (key === "REPAIR-TRIAL-AGREEMENT") {
    return {
      trial_fee: price || "$200",
      scope: "One done-for-you dispute round (bureaus and creditors on your file). You watch progress in your portal."
    };
  }
  if (key === "CREDIT-REPAIR-AGREEMENT") {
    /* one_time_fee, NOT monthly_fee. REPAIR_DFY is $1,000 charged once (owner
       decision 2026-08-31), and the blank this fills used to be called
       monthly_fee inside a template sentence reading "per month while services
       are active" — so the same $1,000 rendered as $1,000 a month for the
       180-day term. db/migrations/273_repair_fee_charged_once.sql rewrites that
       sentence and renames the blank; this is the other half of that rename.
       src/contracts/offer-fee-language.test.mjs fails if the two drift apart
       again.

       term_days and scope are gone from this one: 287 moves how long the work
       runs, and what the work is, into the block of real agreement text Chris
       supplies. Neither was ever a number this catalogue owns. */
    return { one_time_fee: price || "$1,000" };
  }
  if (key === "FUNDING-AGREEMENT") {
    /* "of approved funding", never "of funded amount": the fee base is the
       approved figure, not what is drawn (owner-set 2026-10-20: $100,000
       approved, $10,000 drawn -> the fee is on $100,000). */
    const pct = (o && o.successFeePercent) || 10;
    return {
      deposit: price || "$3,000",
      success_fee: `${pct}% of approved funding`,
      fee_due: "within 7 days of funding"
    };
  }
  if (key === "REPAIR-AND-FUNDING-AGREEMENT") {
    const fund = getOffer("FUNDING_DFY");
    const repair = getOffer("REPAIR_DFY");
    const pct = (fund && fund.successFeePercent) || 10;
    return {
      deposit: formatCents(fund && fund.priceCents) || "$3,000",
      repair_fee: formatCents(repair && repair.priceCents) || "$1,000",
      success_fee: `${pct}% of approved funding`,
      fee_due: "within 7 days of funding",
      term_days: "180",
      repair_scope: "Parallel credit repair on limiting bureaus while funding rounds run.",
      funding_scope: "Full done-for-you funding program: matching, rounds, and inquiry sweeps."
    };
  }
  if (key === "FUNDING-MASTERY-AGREEMENT") {
    return { program_fee: price || "$5,000" };
  }
  if (key === "CAPITAL-BLUEPRINT-AGREEMENT") {
    return { package_fee: price || "$1,000" };
  }
  /* An unknown template — an org's own copy, or PARTNER-LICENSE, whose two
     blanks are genuinely per-partner and are passed in by
     src/contracts/partner-license.mjs. Returning nothing rather than a guess
     means send.mjs leaves those callers exactly as they were. */
  return {};
}

/** Public JSON for the present page — no internals. */
export function offersForClient() {
  return OFFER_KEYS.map((k) => {
    const o = OFFERS[k];
    return {
      key: o.key,
      name: o.name,
      priceCents: o.priceCents,
      priceDisplay: formatCents(o.priceCents),
      priceMinCents: o.priceMinCents ?? null,
      priceMaxCents: o.priceMaxCents ?? null,
      successFeePercent: o.successFeePercent ?? null,
      financing: o.financing,
      letters: o.letters,
      productCode: o.productCode,
      contractTemplateKey: o.contractTemplateKey ?? null,
      contents: o.contents ? [...o.contents] : null
    };
  });
}
