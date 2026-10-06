// The ad set guard: may a new paused ad go into this Meta ad set?
//
// Spec §10.5: refuse an ad set that is archived, uses dynamic creative,
// already has 50 ads, or sits in a campaign without the special ad category.
// The brief adds one more: Meta's special ad category for the campaign must be
// the one our own campaigns row carries (campaigns.special_ad_category,
// confirmed on the live schema 2026-10-05 — text, nullable).
//
// WHY CHECK META AND NOT JUST OUR ROW. api/campaigns/sync.mjs writes "CREDIT"
// into a NEW campaigns row when Meta sends no category at all, so our row can
// say CREDIT while Meta's campaign has none. Only Meta's own answer
// (getAdSetGuardInfo in meta.mjs) proves the category is really set.
//
// PURE. No database, no network: the info comes in, the verdict goes out.
// FAILS CLOSED: when Meta did not say something a rule needs, the rule refuses.
// The one exception is is_dynamic_creative, where only an explicit true
// refuses — Meta reports false for an ordinary ad set, and a missing value is
// not evidence of dynamic creative.
//
// PAUSED IS NOT A REFUSAL. A paused ad set or campaign can take a paused ad;
// it is reported in `notes` so the Launch tab can show it (spec §10.5).

export const META_MAX_ADS_PER_AD_SET = 50;

// Meta's v26 AdSet / Campaign effective_status values (SDK v26.0.2): ACTIVE,
// ARCHIVED, CAMPAIGN_PAUSED, DELETED, IN_PROCESS, PAUSED, WITH_ISSUES.
const GONE = new Set(["ARCHIVED", "DELETED"]);
const PAUSED = new Set(["PAUSED", "CAMPAIGN_PAUSED"]);

const upper = (v) => String(v ?? "").trim().toUpperCase();

/* checkAdSetGuard(info, { ourSpecialAdCategory }) → { ok, reasons, notes }
   reasons — plain sentences, one per broken rule. ok is true only when empty.
   notes   — plain sentences that do not block (paused). */
export function checkAdSetGuard(info, { ourSpecialAdCategory = null } = {}) {
  const reasons = [];
  const notes = [];

  if (!info || typeof info !== "object") {
    return { ok: false, reasons: ["Meta did not tell us anything about this ad set."], notes };
  }

  // 1. The ad set itself.
  const setStatus = upper(info.effective_status);
  if (!setStatus) reasons.push("Meta did not say whether this ad set is live.");
  else if (setStatus === "ARCHIVED") reasons.push("This ad set is archived in Meta. Pick a live ad set.");
  else if (setStatus === "DELETED") reasons.push("This ad set was deleted in Meta. Pick a live ad set.");
  else if (PAUSED.has(setStatus)) notes.push("This ad set is paused in Meta. The new ad will wait there, paused.");

  if (info.is_dynamic_creative === true) {
    reasons.push("This ad set uses dynamic creative. Our ads need a normal ad set.");
  }

  const count = info.ad_count;
  if (count === null || count === undefined || !Number.isFinite(Number(count))) {
    reasons.push("Meta did not say how many ads this ad set has.");
  } else if (Number(count) >= META_MAX_ADS_PER_AD_SET) {
    reasons.push(`This ad set already has ${Number(count)} ads. Meta allows ${META_MAX_ADS_PER_AD_SET}. Pick another ad set.`);
  }

  // 2. Its campaign.
  const campaign = info.campaign;
  if (!campaign || typeof campaign !== "object") {
    reasons.push("Meta did not say which campaign this ad set is in.");
    return { ok: reasons.length === 0, reasons, notes };
  }

  const campStatus = upper(campaign.effective_status);
  if (GONE.has(campStatus)) {
    reasons.push(`This ad set's campaign is ${campStatus === "ARCHIVED" ? "archived" : "deleted"} in Meta.`);
  } else if (PAUSED.has(campStatus)) {
    notes.push("This ad set's campaign is paused in Meta.");
  }

  const metaCategories = Array.isArray(campaign.special_ad_categories)
    ? campaign.special_ad_categories.map(upper).filter((c) => c && c !== "NONE")
    : [];
  const ours = upper(ourSpecialAdCategory);

  if (metaCategories.length === 0) {
    reasons.push("This ad set's campaign has no special ad category in Meta. Ads about credit and money need one.");
  }
  if (!ours || ours === "NONE") {
    reasons.push("Our campaign record has no special ad category, so we cannot check Meta's.");
  } else if (metaCategories.length && !metaCategories.includes(ours)) {
    reasons.push(
      `Meta's campaign says ${metaCategories.join(", ")}, but our campaign record says ${ours}. They must match.`
    );
  }

  return { ok: reasons.length === 0, reasons, notes };
}

export default { checkAdSetGuard, META_MAX_ADS_PER_AD_SET };
