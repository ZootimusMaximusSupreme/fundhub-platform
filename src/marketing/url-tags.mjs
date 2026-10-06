// src/marketing/url-tags.mjs — the UTMs a Meta ad carries, in the owner-set
// format (spec docs/specs/marketing-machine-2026-10-04.md §10.3, migration 286).
//
//   utm_source=fb&utm_medium=paid&utm_campaign=<lane>&utm_content=<ad number>
//   …&utm_term=<variant>   only when the ad has a variant
//
// WHERE IT GOES. The string goes in the Meta creative's `url_tags`, NEVER in the
// link itself (spec §10.3). Meta adds url_tags to the link when a person taps.
//
// WHY EVERY PART IS CHECKED HERE. The database derives the lead's facts from
// these exact values (286, 407):
//   * utm_campaign → fundhub_ad_lane(). A value it does not know makes the
//     lead's lane "unknown", silently. So only the lanes it knows are allowed:
//     the five in LANES plus slo (406/407).
//   * utm_content → fundhub_ad_id(), the leading digits. So the ad number must
//     be 1-9 digits, the same rule as ads_fundhub_ad_number_ck (377:569).
//   * utm_term → fundhub_ad_variant(), which lowercases and squeezes the text.
//     The variant is written here already squeezed (variantOf, the JS mirror),
//     so what the lead row stores is exactly what was sent.
// A wrong input throws. A builder that guessed would load an ad whose leads
// can never be tied back to it, and nothing would say so.
//
// Every value is plain [a-z0-9_-] after these checks, so nothing needs URL
// encoding and the string reads the same in Meta's UI as here.

import { LANES, SLO_LANE, variantOf } from "../ads/registry.mjs";

/** The lanes fundhub_ad_lane() (286, 407) maps to themselves. */
export const URL_TAG_LANES = Object.freeze([...LANES, SLO_LANE]);

const AD_NUMBER = /^[0-9]{1,9}$/;

function laneOrThrow(lane) {
  const l = String(lane ?? "").trim().toLowerCase();
  if (!URL_TAG_LANES.includes(l)) {
    throw new Error(
      `buildUrlTags: lane ${JSON.stringify(lane)} is not one the database knows ` +
      `(${URL_TAG_LANES.join(", ")}). The lead's lane would read "unknown".`
    );
  }
  return l;
}

function numberOrThrow(adNumber) {
  let n = null;
  if (typeof adNumber === "number") {
    if (Number.isSafeInteger(adNumber) && adNumber >= 0) n = String(adNumber);
  } else if (typeof adNumber === "string") {
    n = adNumber.trim();
  }
  if (n == null || !AD_NUMBER.test(n)) {
    throw new Error(
      `buildUrlTags: ad number ${JSON.stringify(adNumber)} must be 1 to 9 digits ` +
      "(our number, not Meta's ad id)."
    );
  }
  return n;
}

/**
 * buildUrlTags({ lane, adNumber, variant? }) → the url_tags string.
 *
 * lane      one of URL_TAG_LANES (any case; written lowercase)
 * adNumber  our ad number, "91" or 91
 * variant   optional. Left out, null or blank → no utm_term at all. Anything
 *           else is squeezed the way fundhub_ad_variant() squeezes it; a
 *           variant with nothing left after that is refused, not dropped.
 */
export function buildUrlTags({ lane, adNumber, variant } = {}) {
  const parts = [
    ["utm_source", "fb"],
    ["utm_medium", "paid"],
    ["utm_campaign", laneOrThrow(lane)],
    ["utm_content", numberOrThrow(adNumber)]
  ];

  const blank = variant == null || String(variant).trim() === "";
  if (!blank) {
    const v = variantOf(variant);
    if (!v) {
      throw new Error(
        `buildUrlTags: variant ${JSON.stringify(variant)} has nothing left once ` +
        "squeezed to a-z, 0-9, _ and -. Leave it out for no variant."
      );
    }
    parts.push(["utm_term", v]);
  }

  return parts.map(([k, v]) => `${k}=${v}`).join("&");
}

export default buildUrlTags;
