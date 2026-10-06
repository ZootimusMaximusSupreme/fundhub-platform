// src/ads/ad-number.mjs — which of OUR ad numbers a Meta visitor came from.
//
// THE DATABASE IS THE SOURCE OF TRUTH. A visitor row's ad number is filled by
// a trigger in db/migrations/407_ad_number_from_meta.sql
// (fundhub_caa_set_ad_id → fundhub_meta_ad_number). This file is the JS MIRROR
// of that rule, the same way laneOf / adIdOf in ./registry.mjs mirror 286: so a
// caller holding raw tags and a list of ads can ask the same question without
// a round trip, and so the rule is pinned by tests that run without Postgres.
// src/http/ad-number.pg.test.mjs runs the SAME cases through the SQL function
// and fails if the two ever disagree.
//
// THE RULE (owner-set 2026-10-05: ad set id + ad name, no change to live ads).
// The live Meta ads send utm_content={{ad.name}} ("oVid: SLO2") and
// utm_term={{adset.id}} ("120253626444640264").
//   1. Leading digits of utm_content win, exactly as before ("84-slo-ad-1" → 84).
//   2. Else: the ads in OUR table whose ad set has that Meta id and whose name
//      is exactly that name (trimmed; case counts).
//        - none                                   → null
//        - two different Meta ads with that name  → null (ambiguous)
//        - one Meta ad, but no Fundhub number yet → null
//        - one Meta ad, one Fundhub number        → that number
//      The ad set id must be digits; anything else (a variant like "sun") can
//      never match. A blank name never matches.
// No closest name, no fuzzy match, no guess.

import { adIdOf } from "./registry.mjs";

const ADSET_ID = /^[0-9]{1,30}$/;
/* Postgres btrim(x) with no second argument strips SPACES only, not tabs or
   newlines. Mirrored exactly, so the two sides cannot disagree on an odd name. */
const trim = (v) => (v == null ? "" : String(v).replace(/^ +| +$/g, ""));

/**
 * metaAdNumberOf(ads, { orgId, adsetId, adName }) → our ad number (text) or null.
 *
 * `ads` is a list of our ad rows, each
 *   { org_id, adset_external_id, external_id, name, fundhub_ad_number }.
 * `orgId` is optional here; when given, rows from another company never match
 * (the SQL always binds it).
 */
export function metaAdNumberOf(ads, { orgId = null, adsetId, adName } = {}) {
  const set = trim(adsetId);
  const name = trim(adName);
  if (!ADSET_ID.test(set) || !name) return null;

  const matches = (Array.isArray(ads) ? ads : []).filter((a) =>
    a && typeof a === "object" &&
    (orgId == null || a.org_id === orgId) &&
    a.adset_external_id === set &&
    trim(a.name) === name
  );

  // count(DISTINCT x) in SQL skips NULL and nothing else.
  const metaIds = new Set(matches.map((a) => a.external_id).filter((v) => v != null));
  const numbers = new Set(matches.map((a) => a.fundhub_ad_number).filter((v) => v != null));
  if (metaIds.size !== 1 || numbers.size !== 1) return null;
  return String([...numbers][0]);
}

/**
 * adNumberOf({ utm_content, utm_term }, ads, { orgId }) → our ad number or null.
 * Step 1 (leading digits) then step 2 (the Meta match). Mirrors the trigger.
 */
export function adNumberOf(tags = {}, ads = [], { orgId = null } = {}) {
  const t = tags && typeof tags === "object" ? tags : {};
  return adIdOf(t.utm_content) ??
    metaAdNumberOf(ads, { orgId, adsetId: t.utm_term, adName: t.utm_content });
}

export default adNumberOf;

/* ── mapAdNumber — the number a Meta ad carries, read from Meta's own record ──
 *
 * Spec docs/specs/marketing-machine-2026-10-04.md §10.5 "Sync mapping", pure
 * part. The daily Meta sync (U27 wires it into api/campaigns/sync.mjs) asks
 * Meta for each ad's creative{url_tags} and its name, and calls this.
 *
 *   1. utm_content in the url_tags: its leading digits, by the SAME rule as
 *      fundhub_ad_id() in 286 (adIdOf). "91" and "91-roadmap" are 91. That is
 *      the number a lead from this ad will carry, so the two always agree.
 *   2. Else the ad name: "Ad <digits>" as a word ("Ad 91 — angle" is 91). A run
 *      of more than nine digits is refused rather than cut short, and "Ad" must
 *      start a word ("Load 7" is nothing). Case counts, as the spec writes it.
 *   3. Else null. "oVid: SLO1" is null — no number is guessed.
 *
 * It NEVER throws: a bad url_tags string, a missing name, or a wrong type is
 * null. The caller must never overwrite a 'manual' number with this answer
 * (spec §10.5); that rule lives with the caller, which knows the row.
 *
 * Returns { number: "<digits>" as text, like ads.fundhub_ad_number,
 *           source: "utm" | "name" } or null.
 */
const NAME_NUMBER = /(?:^|[^A-Za-z0-9_])Ad ([0-9]{1,9})(?![0-9])/;

function utmContentOf(urlTags) {
  if (urlTags == null) return null;
  if (typeof urlTags === "object") {
    const v = urlTags.utm_content;
    return typeof v === "string" ? v : null;
  }
  if (typeof urlTags !== "string") return null;
  return new URLSearchParams(urlTags.trim().replace(/^\?/, "")).get("utm_content");
}

export function mapAdNumber(input) {
  try {
    // Read inside the try: a null or a non-object argument is null, not a throw.
    const { urlTags, name } = input && typeof input === "object" ? input : {};
    const fromUtm = adIdOf(utmContentOf(urlTags));
    if (fromUtm != null) return { number: fromUtm, source: "utm" };

    if (typeof name === "string") {
      const m = NAME_NUMBER.exec(name);
      if (m) return { number: m[1], source: "name" };
    }
    return null;
  } catch {
    return null;
  }
}
