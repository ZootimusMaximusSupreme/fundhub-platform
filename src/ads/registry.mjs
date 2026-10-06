// src/ads/registry.mjs — the ad registry the closer reads.
//
// One JSON file, marketing/ads/registry.json, one entry per ad id. This module
// loads it once, validates every entry against the vocabulary at the top of
// the file, and resolves an ad_id (the leading digits of utm_content, as
// derived in the database by 286_client_ad_attribution.sql) to its tags.
//
// UNKNOWN IS THE SORTING DEFAULT. An ad id the registry does not know resolves
// to gate none, entry sorting, primary none, secondary all — the widest door —
// and is logged once per id. That is deliberate: a closer who cannot tell what
// the person was promised should lead with the assessment, not guess a pitch.
//
// The lane the ROW carries comes from utm_campaign in the database; the lane
// the REGISTRY carries is what the ad was filed under. They should agree, and
// resolve() returns both so a mismatch is visible rather than hidden.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REGISTRY_PATH = path.join(ROOT, "marketing", "ads", "registry.json");

export const LANES = Object.freeze(["funding600", "premium", "sorting", "uwiq", "wl"]);
export const GATES = Object.freeze(["600", "720", "780", "none"]);
export const ENTRIES = Object.freeze(["direct", "sorting"]);
export const OFFERS = Object.freeze([
  "funding_dfy", "credit_optimization", "capital_blueprint", "capital_academy", "white_label", "none"
]);

/** What an unknown ad id resolves to. Frozen so nobody mutates the default. */
export const UNKNOWN_AD = Object.freeze({
  known: false,
  id: null,
  title: null,
  lane: null,
  gate: "none",
  entry: "sorting",
  primary_offer: "none",
  secondary_offers: "all",
  variants: Object.freeze([])
});

/* JS mirrors of the SQL derivations in 286. The database is the source of
   truth for stored rows; these exist so a caller holding raw UTMs (a test, a
   preview, the fragment) can ask the same question without a round trip. */
/* The roadmap (SLO) lane, added to the ad_lane enum in 406 and mapped in 407.
   It is NOT in LANES on purpose: LANES is what a person may pick for a script
   (api/scripts/write.mjs, the Creative Factory picker), while `slo` is a lane
   that arrives on the wire from a campaign NAME like "oPur: TOF-SLO: $297".
   Same rule as fundhub_ad_lane() in 407: the five exact names first, then the
   word SLO standing on its own ("slow" and "slo2" do not count). */
export const SLO_LANE = "slo";
const SLO_WORD = /(^|[^a-z0-9])slo([^a-z0-9]|$)/;

export function laneOf(utmCampaign) {
  const s = String(utmCampaign ?? "").trim().toLowerCase();
  if (LANES.includes(s)) return s;
  return SLO_WORD.test(s) ? SLO_LANE : "unknown";
}

export function adIdOf(utmContent) {
  const m = /^([0-9]{1,9})(?:[-_][^\s]*)?$/.exec(String(utmContent ?? "").trim());
  return m ? m[1] : null;
}

export function variantOf(utmTerm) {
  const s = String(utmTerm ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 64)
    .replace(/^-+|-+$/g, "");
  return s || null;
}

function fail(id, msg) {
  throw new Error(`marketing/ads/registry.json: ad ${id == null ? "(no id)" : JSON.stringify(id)} — ${msg}`);
}

/** Validate one raw entry; returns the frozen, normalised ad. */
function normaliseAd(raw) {
  if (!raw || typeof raw !== "object") fail(null, "entry is not an object");
  const id = String(raw.id ?? "").trim();
  if (!/^[0-9]{1,9}$/.test(id)) fail(raw.id, "id must be the ad number as a string of digits");
  if (!LANES.includes(raw.lane)) fail(id, `lane must be one of ${LANES.join("|")}`);
  if (!GATES.includes(String(raw.gate))) fail(id, `gate must be one of ${GATES.join("|")}`);
  if (!ENTRIES.includes(raw.entry)) fail(id, `entry must be one of ${ENTRIES.join("|")}`);
  if (!OFFERS.includes(raw.primary_offer)) fail(id, `primary_offer must be one of ${OFFERS.join("|")}`);
  let secondary;
  if (raw.secondary_offers === "all") {
    secondary = "all";
  } else if (Array.isArray(raw.secondary_offers)) {
    for (const o of raw.secondary_offers) {
      if (!OFFERS.includes(o)) fail(id, `secondary_offers contains ${JSON.stringify(o)}`);
    }
    secondary = Object.freeze([...raw.secondary_offers]);
  } else {
    fail(id, 'secondary_offers must be a list of offers or the string "all"');
  }
  if (raw.entry === "sorting" && secondary !== "all") {
    fail(id, 'entry "sorting" means every road is open — secondary_offers must be "all"');
  }
  if (!Array.isArray(raw.variants)) fail(id, "variants must be a list");
  return Object.freeze({
    known: true,
    id,
    title: raw.title == null ? null : String(raw.title),
    lane: raw.lane,
    gate: String(raw.gate),
    entry: raw.entry,
    primary_offer: raw.primary_offer,
    secondary_offers: secondary,
    variants: Object.freeze(raw.variants.map((v) => String(v))),
    group: raw.group == null ? null : String(raw.group)
  });
}

let cache = null;

/** Parse and validate a registry document (the JSON's object form). Exported for tests. */
export function parseRegistry(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.ads)) {
    throw new Error("marketing/ads/registry.json: expected an object with an `ads` list");
  }
  const byId = new Map();
  for (const raw of doc.ads) {
    const ad = normaliseAd(raw);
    if (byId.has(ad.id)) fail(ad.id, "listed twice");
    byId.set(ad.id, ad);
  }
  return Object.freeze({
    version: doc.version ?? null,
    updated: doc.updated ?? null,
    byId,
    ads: Object.freeze([...byId.values()])
  });
}

/** Load marketing/ads/registry.json once. `reload: true` re-reads the file. */
export function loadRegistry({ reload = false, file = REGISTRY_PATH } = {}) {
  if (cache && !reload && file === REGISTRY_PATH) return cache;
  const parsed = parseRegistry(JSON.parse(fs.readFileSync(file, "utf8")));
  if (file === REGISTRY_PATH) cache = parsed;
  return parsed;
}

const warned = new Set();

/** Resolve an ad id to its tags. Unknown → UNKNOWN_AD, logged once per id. */
export function resolveAd(adId, { registry = loadRegistry(), log = console } = {}) {
  const id = adId == null ? null : String(adId).trim();
  if (id && registry.byId.has(id)) return registry.byId.get(id);
  const key = id || "(none)";
  if (!warned.has(key)) {
    warned.add(key);
    log.warn(`[ads/registry] unknown ad_id ${key} — resolved to the sorting default (gate none, entry sorting, primary none, secondary all)`);
  }
  return id ? Object.freeze({ ...UNKNOWN_AD, id }) : UNKNOWN_AD;
}

/** Every ad carrying a given tag value: gate / entry / primary_offer / secondary_offer / lane / group. */
export function adsWithTag(tag, value, { registry = loadRegistry() } = {}) {
  const v = String(value);
  return registry.ads.filter((ad) => {
    switch (tag) {
      case "lane": return ad.lane === v;
      case "gate": return ad.gate === v;
      case "entry": return ad.entry === v;
      case "primary_offer": return ad.primary_offer === v;
      case "secondary_offer":
        return ad.secondary_offers === "all" ? v !== "none" : ad.secondary_offers.includes(v);
      case "group": return ad.group === v;
      default: return false;
    }
  });
}

/* Ad ids the registry lists with no title, in file order.

   The title is the word after the dash in utm_content (42-ringlights → 42 +
   "ringlights"). Only the owner can name an ad, so an untitled one cannot be
   fixed by an agent — but it is not harmless: every report grouped by ad name
   shows a bare digit with no label, and the closer screen prints the id where
   the ad's name belongs. 21 of the 24 seeded ads were untitled on 2026-09-03
   (F7). scripts/ads/check-registry-titles.mjs turns this list into a
   non-zero exit so the gap cannot quietly ship. */
export function untitledAdIds({ registry = loadRegistry() } = {}) {
  return registry.ads.filter((ad) => ad.title == null || ad.title === "").map((ad) => ad.id);
}

/** Test hook: forget the cached file and the once-per-id warning set. */
export function _resetRegistry() {
  cache = null;
  warned.clear();
}
