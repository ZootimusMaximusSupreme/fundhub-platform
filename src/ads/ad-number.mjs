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
