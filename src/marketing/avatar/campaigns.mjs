// @ts-check
// Flywheel campaigns: the folder name, the offer it sells, its name in words, and the
// "What we sell" text the avatar run starts from.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 (the campaign picker,
// "Start a flywheel makes a folder and owner-notes file for any offer key in
// src/config/offers.mjs", "What we sell" pre-filled from the offer facts) and §3.0
// (campaign folder names map to words: partner -> "Partner offer"). Unit X1.
//
// THE MAP. "partner" is the one folder that predates this file; it sells the
// white-label partner program (OFFERS.PARTNER_ENTRY). Every other campaign is the
// offer key in folder form (CAPITAL_BLUEPRINT -> capital-blueprint), so the map
// needs no table and can never drift from src/config/offers.mjs.
//
// NO PRICE IS TYPED HERE. Prices come from src/config/offers.mjs through formatCents.

import { OFFERS, OFFER_KEYS, formatCents } from "../../config/offers.mjs";
import { isCampaign } from "../offer-inputs.mjs";

/** Folders whose offer is not their own name. */
export const CAMPAIGN_OFFER_KEYS = Object.freeze({ partner: "PARTNER_ENTRY" });

/** The words a folder name reads as on the page. */
const CAMPAIGN_WORDS = Object.freeze({ partner: "Partner offer" });

export { isCampaign };

/** The folder a new flywheel for this offer key gets. */
export function campaignForOfferKey(key) {
  const k = String(key || "");
  for (const [c, ok] of Object.entries(CAMPAIGN_OFFER_KEYS)) if (ok === k) return c;
  return k.toLowerCase().replace(/_/g, "-");
}

/** The offer key a campaign sells, or null when it names no offer. */
export function offerKeyForCampaign(campaign) {
  if (!isCampaign(campaign)) return null;
  if (Object.prototype.hasOwnProperty.call(CAMPAIGN_OFFER_KEYS, campaign)) return CAMPAIGN_OFFER_KEYS[/** @type {keyof typeof CAMPAIGN_OFFER_KEYS} */ (campaign)];
  return OFFER_KEYS.find((k) => campaignForOfferKey(k) === campaign) || null;
}

/** "partner" -> "Partner offer"; any other folder -> its offer's name, else the folder in words. */
export function campaignWords(campaign) {
  if (Object.prototype.hasOwnProperty.call(CAMPAIGN_WORDS, campaign)) return CAMPAIGN_WORDS[/** @type {keyof typeof CAMPAIGN_WORDS} */ (campaign)];
  const key = offerKeyForCampaign(campaign);
  if (key && OFFERS[key]) return OFFERS[key].name;
  const s = String(campaign || "").replace(/-/g, " ");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/**
 * "What we sell" — the service text the avatar SOP profiles, pre-filled for a
 * campaign. Chris may replace it on the cost sheet. null when the campaign names no
 * offer (he must type one).
 */
export function defaultServiceDescription(campaign) {
  const key = offerKeyForCampaign(campaign);
  const o = key ? OFFERS[key] : null;
  if (!o) return null;
  const price = formatCents(o.priceCents);
  if (key === "PARTNER_ENTRY") {
    // The service line the chat SOP ran with (.claude/workflows/avatar-builder.js),
    // its price read from src/config/offers.mjs.
    return `The Fundhub ${price} white-label partnership: brokers run a funding company under their own brand, Fundhub does all fulfillment, partner keeps 50% of funding and repair.`;
  }
  return `${o.name} from Fundhub${price ? `, ${price}` : ""}.`;
}
