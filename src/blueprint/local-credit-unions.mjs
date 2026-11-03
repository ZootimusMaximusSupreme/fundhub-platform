/* Server-only source data. This module makes no external request and returns at
 * most five institutions, never the source directory or a client address. */
import directory from "./local-credit-union-data.json" with { type: "json" };

const EARTH_MILES = 3958.7613;
const radians = n => n * Math.PI / 180;
const clean = (v, max = 160) => typeof v === "string" ? v.trim().slice(0, max) : "";
const postal = v => /^\d{5}(?:-\d{4})?$/.test(clean(v, 10)) ? clean(v, 10).slice(0, 5) : null;
const finite = v => typeof v === "number" && Number.isFinite(v);
const STATE_CODES = Object.freeze(Object.fromEntries([
  "AL:Alabama", "AK:Alaska", "AZ:Arizona", "AR:Arkansas", "CA:California", "CO:Colorado", "CT:Connecticut", "DE:Delaware", "DC:District of Columbia", "FL:Florida", "GA:Georgia", "HI:Hawaii", "ID:Idaho", "IL:Illinois", "IN:Indiana", "IA:Iowa", "KS:Kansas", "KY:Kentucky", "LA:Louisiana", "ME:Maine", "MD:Maryland", "MA:Massachusetts", "MI:Michigan", "MN:Minnesota", "MS:Mississippi", "MO:Missouri", "MT:Montana", "NE:Nebraska", "NV:Nevada", "NH:New Hampshire", "NJ:New Jersey", "NM:New Mexico", "NY:New York", "NC:North Carolina", "ND:North Dakota", "OH:Ohio", "OK:Oklahoma", "OR:Oregon", "PA:Pennsylvania", "RI:Rhode Island", "SC:South Carolina", "SD:South Dakota", "TN:Tennessee", "TX:Texas", "UT:Utah", "VT:Vermont", "VA:Virginia", "WA:Washington", "WV:West Virginia", "WI:Wisconsin", "WY:Wyoming"
].flatMap(value => { const [code, name] = value.split(":"); return [[code, code], [name.toUpperCase(), code]]; })));

export const LOCAL_CREDIT_UNION_SOURCES = Object.freeze({
  branches: { name: directory.source.name, asOf: directory.source.asOf, url: directory.source.url },
  coordinates: { name: directory.coordinateSource.name, asOf: directory.coordinateSource.asOf, url: directory.coordinateSource.url }
});

export function greatCircleMiles(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2 ||
      ![...a.slice(0, 2), ...b.slice(0, 2)].every(finite) ||
      Math.abs(a[0]) > 90 || Math.abs(b[0]) > 90 || Math.abs(a[1]) > 180 || Math.abs(b[1]) > 180) return null;
  const dLat = radians(b[0] - a[0]), dLon = radians(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function fitFor(charter, context) {
  const input = context.reviewedFits?.[charter];
  const now = Date.parse(context.asOf);
  const reviewed = Date.parse(input?.reviewedAt);
  let sourceUrl = null;
  try { const url = new URL(input?.sourceUrl); if (url.protocol === "https:") sourceUrl = url.href; } catch {}
  // Client-reported membership/cash or an undated generic row does not become
  // a current reviewed product requirement. The caller supplies trusted reviews.
  const current = sourceUrl && Number.isFinite(now) && Number.isFinite(reviewed) && reviewed <= now && now - reviewed <= 90 * 86400000;
  if (!current) return { membershipStatus: "not_reviewed", productStatus: "not_reviewed", cashFit: "not_reviewed", minimumDepositCents: null, reviewedAt: null, termsSourceUrl: null };
  const membershipStatus = input.membershipEligible === true ? "reviewed_eligible" : input.membershipEligible === false ? "reviewed_ineligible" : "not_reviewed";
  const productStatus = input.businessAccountAvailable === true ? "reviewed_available" : input.businessAccountAvailable === false ? "reviewed_unavailable" : "not_reviewed";
  const minimum = Number.isSafeInteger(input.minimumDepositCents) && input.minimumDepositCents >= 0 ? input.minimumDepositCents : null;
  const cash = Number.isSafeInteger(context.availableCashCents) && context.availableCashCents >= 0 ? context.availableCashCents : null;
  const cashFit = minimum === null || cash === null ? "not_reviewed" : cash >= minimum ? "within_stated_cash" : "above_stated_cash";
  return { membershipStatus, productStatus, cashFit, minimumDepositCents: minimum, reviewedAt: input.reviewedAt, termsSourceUrl: sourceUrl };
}

/**
 * Rank distinct actual institutions by approximate geographic fit. A ZIP uses
 * the Census ZCTA internal point. Branches use their ZIP area's point; this is
 * not a branch geocode, driving distance or approval likelihood. When a ZIP has
 * no Census point, exact-ZIP / same-city matches remain honestly labelled and
 * have no invented distance. State-only matches never appear as local.
 *
 * Optional data injection keeps geographic, dedupe and fit tests deterministic.
 */
export function rankLocalCreditUnions(context = {}, data = directory) {
  const zip = postal(context.postalCode);
  const city = clean(context.city, 100).toUpperCase();
  const state = STATE_CODES[clean(context.homeState || context.state, 80).toUpperCase()] || "";
  const customerPoint = finite(context.latitude) && finite(context.longitude) && Math.abs(context.latitude) <= 90 && Math.abs(context.longitude) <= 180
    ? [context.latitude, context.longitude] : null;
  const point = customerPoint || (zip ? data.postalCentroids?.[zip] : null);
  const maxDistance = finite(context.maxDistanceMiles) && context.maxDistanceMiles > 0 ? Math.min(context.maxDistanceMiles, 100) : 50;
  const limit = Number.isInteger(context.limit) && context.limit > 0 ? Math.min(context.limit, 5) : 5;
  const source = {
    ...data.source,
    coordinateSource: data.coordinateSource,
    locationMethod: point ? (customerPoint ? "client_point_to_branch_zip_area" : "zip_area_centers") : "exact_zip_or_city_only"
  };
  const base = {
    status: "location_required",
    location: { postalCode: zip, city: city || null, state: state || null },
    source,
    candidates: [],
    limitations: [
      "Distances are approximate ZIP-area comparisons, not street or driving distance.",
      "Branch information is source-dated. Confirm the branch is open and currently provides the service you need.",
      "Membership, business-account availability, deposits and credit approval need their own current review."
    ]
  };
  if (!point && !zip && !(city && state)) return base;
  const byInstitution = new Map();
  for (const row of data.branches || []) {
    const [charter, siteId, address, branchCity, branchState, branchZip] = row;
    if (!data.institutions?.[charter]) continue;
    const branchPoint = data.postalCentroids?.[branchZip];
    const distance = point && branchPoint ? greatCircleMiles(point, branchPoint) : null;
    const exactZip = zip && branchZip === zip;
    const sameCity = city && state && clean(branchCity).toUpperCase() === city && branchState === state;
    if (distance === null ? !exactZip && !sameCity : distance > maxDistance) continue;
    const fit = fitFor(charter, context);
    if (fit.membershipStatus === "reviewed_ineligible" || fit.productStatus === "reviewed_unavailable") continue;
    const locationMatch = exactZip ? "same_zip_area" : distance !== null ? "nearby_zip_area" : "same_city";
    const candidate = {
      charterNumber: String(charter), name: data.institutions[charter],
      branch: { siteId: String(siteId), address, city: branchCity, state: branchState, postalCode: branchZip },
      distanceMiles: distance === null ? null : Math.round(distance * 10) / 10,
      distanceLabel: exactZip ? "Same ZIP area" : distance === null ? "Same city" : `About ${Math.round(distance * 10) / 10} miles between ZIP-area centers`,
      locationMatch, ...fit,
      locatorUrl: "https://mapping.ncua.gov/",
      nextStep: "Confirm membership, the exact business account, current deposit/fees and branch services before applying.",
      _distance: distance === null ? Infinity : distance,
      _locationRank: exactZip ? 0 : distance !== null ? 1 : 2
    };
    const current = byInstitution.get(String(charter));
    if (!current || candidate._locationRank < current._locationRank ||
        (candidate._locationRank === current._locationRank && candidate._distance < current._distance)) byInstitution.set(String(charter), candidate);
  }
  const ranked = [...byInstitution.values()].sort((a, b) => {
    const aFit = (a.membershipStatus === "reviewed_eligible" ? 0 : 2) + (a.cashFit === "above_stated_cash" ? 2 : 0);
    const bFit = (b.membershipStatus === "reviewed_eligible" ? 0 : 2) + (b.cashFit === "above_stated_cash" ? 2 : 0);
    return aFit - bFit || a._locationRank - b._locationRank || a._distance - b._distance || a.name.localeCompare(b.name) || a.charterNumber.localeCompare(b.charterNumber);
  }).slice(0, limit).map(({ _distance, _locationRank, ...candidate }) => candidate);
  return { ...base, status: ranked.length ? "candidates_for_review" : "no_candidates_in_range", candidates: ranked };
}

export default rankLocalCreditUnions;
