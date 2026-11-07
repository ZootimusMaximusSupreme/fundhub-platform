// Local banks and credit unions near the client's home and business addresses
// (Finance OS wave 4, unit LOC, 2026-11-07).
//
// TWO ANSWERS, ONE READ. Sent on GET /api/money/banks:
//   local_banks   "Which banks and credit unions have a branch near me?"
//   deposit_plan  the bank plan for the next 6 months: up to 5 banks, now with
//                 the local finds merged into Giovanni's list.
// ?view=local_banks sends only those two (api/money/banks.mjs).
//
// WHERE EVERY FACT COMES FROM
//   Banks           FDIC BankFind Suite: every full-service office of every active
//                   FDIC-insured bank (src/finance/fdic-branch-data.json, built by
//                   scripts/build-fdic-branch-data.mjs from api.fdic.gov).
//   Credit unions   NCUA Call Report branch file: member-service offices (the file
//                   src/blueprint/local-credit-unions.mjs already reads), and from
//                   the same quarter's FOICU file the type of membership
//                   (src/finance/ncua-membership-data.json, built by
//                   scripts/build-ncua-membership-data.mjs). A credit union only
//                   one group can join (one employer, church, school, the
//                   military or a government) is never offered: nothing on the
//                   file says the client is in that group (the Navy Federal rule,
//                   Chris 2026-11-07). A community charter needs no note; any
//                   other credit union says "Check who can join".
//   Distance        Census ZCTA internal points from that same file: ZIP area to
//                   ZIP area, never street or driving distance.
//   Giovanni's list lenders.active (migration 504), as bank-strategy.mjs already
//                   reads it: recommended_banks (the plan banks) and banks_left_out
//                   (membership or no-account banks). A list bank is tied to its
//                   FDIC certificate or NCUA charter by LIST_INSTITUTIONS, each one
//                   checked against the two files (local-banks.test.mjs).
//   Logos           Plaid's, then the bank book's, then the name only
//                   (src/banking/institution-logos.mjs findLogos).
//
// PRIVACY. Only the ZIP, city and state of an address are read; the street, the
// SSN and the rest of the identity row are never selected. Nothing leaves: both
// directories are files in the bundle and no provider is called.
//
// THE PLAN ORDER (owner order 2026-11-07: "recommend up to 5 for the next 6
// months"; 5 is the cap bankSteps already uses):
//   1. banks on Giovanni's list with a branch near one of your addresses;
//   2. local banks and credit unions near you, nearest first. "Local" is the
//      owner's own word (Chris, 2026-09-04, src/pulse/beats/lib/lender-match.mjs):
//      banks that only do business in your home and business states;
//   3. banks on Giovanni's list with no branch near you.
// A bank staff already put on the tracker is never pushed off by a local find.
// A bank the book says you cannot join (Navy Federal) or that needs no account
// is never added. No date is guessed: the day to open stays staff-set.
//
// NEVER A BROKEN PAGE. attachLocalBanks() catches everything: on a failure the
// bank read keeps its own deposit_plan and local_banks says "unavailable".

import fdicData from "./fdic-branch-data.json" with { type: "json" };
import membershipData from "./ncua-membership-data.json" with { type: "json" };
import ncuaData from "../blueprint/local-credit-union-data.json" with { type: "json" };
import { greatCircleMiles } from "../blueprint/local-credit-unions.mjs";
import { bankSteps, depositPlanRows } from "../waypoints/blueprint-path.mjs";
import { bankKey, findLogos } from "../banking/institution-logos.mjs";

/** Search radius: the same 50-mile cap src/blueprint/local-credit-unions.mjs uses. */
export const MAX_MILES = 50;
/** How many institutions the list shows. A display size, not a rule. */
export const NEARBY_SHOWN = 8;
/** The plan's cap: bankSteps' own maxBanks. */
export const PLAN_MAX = 5;
/** The plan's window (owner order 2026-11-07). */
export const PLAN_MONTHS = 6;
/** At most this many addresses are searched (home plus businesses). */
export const MAX_PLACES = 6;

export const DEFAULT_DATA = Object.freeze({
  banks: fdicData, creditUnions: ncuaData, centroids: ncuaData.postalCentroids, membership: membershipData.codes
});

export const LOCAL_BANK_SOURCES = Object.freeze({
  banks: Object.freeze({ label: "FDIC BankFind", name: fdicData.source.name, asOf: fdicData.source.asOf, url: fdicData.source.docs }),
  credit_unions: Object.freeze({ label: "NCUA", name: ncuaData.source.name, asOf: ncuaData.source.asOf, url: ncuaData.source.referenceUrl || ncuaData.source.url }),
  membership: Object.freeze({ label: "NCUA", name: membershipData.source.name, asOf: membershipData.source.asOf }),
  distance: Object.freeze({ label: "Census ZIP areas", name: ncuaData.coordinateSource.name, asOf: ncuaData.coordinateSource.asOf })
});

/* ------------------------------------------------------------------ *
 * Who can join a credit union (NCUA TOM_CODE)
 * ------------------------------------------------------------------ */

const COMMUNITY_TOM = new Set(["00", "66", "77"]);

/**
 * joinRule(tom) → "community" | "one_group" | "check"
 *   community  00 community, 66 rural district, 77 next to a metro area
 *   one_group  01-24: one faith, fraternal or other association, a school, the
 *              military, a government, or one employer's staff
 *   check      34-54 and 98 (several groups), 99 (state charter, no type), unknown
 */
export function joinRule(tom) {
  const code = typeof tom === "string" && /^\d{2}$/.test(tom) ? tom : null;
  if (!code) return "check";
  if (COMMUNITY_TOM.has(code)) return "community";
  const n = Number(code);
  if (n >= 1 && n <= 24) return "one_group";
  return "check";
}

/* ------------------------------------------------------------------ *
 * Small readers
 * ------------------------------------------------------------------ */

const rows = (v) => (Array.isArray(v) ? v : []);
function text(v, max = 160) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/** "85004" from "85004" or "85004-1234". Anything else → null. */
export function cleanZip(v) {
  const s = text(v, 12);
  return s && /^\d{5}(?:-\d{4})?$/.test(s) ? s.slice(0, 5) : null;
}

/** A two-letter state code, upper case, or null. */
export function cleanState(v) {
  const s = text(v, 4);
  return s && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null;
}

function cleanCity(v) {
  const s = text(v, 60);
  return s ? s.toUpperCase() : null;
}

const validPoint = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

/* ------------------------------------------------------------------ *
 * The client's places: home and each business, ZIP / city / state only
 * ------------------------------------------------------------------ */

/**
 * clientPlaces({ identity, customFields, businesses }) → [{ kind, label, zip, city, state }]
 *
 * identity   [{ zip, city, state }] from pii_identity.addresses (the soft-pull
 *            consent form's current address). The first usable one is home.
 * customFields  { bp_zip, bp_state, zip, city, state } — the Blueprint setup's home
 *            ZIP (blueprint_business_plans.postalCode), then plain person fields.
 *            Read only when the identity row has no usable home.
 * businesses [{ id, name, zip, city, state }] from businesses.entity_data.
 * One search per ZIP: a business in the home ZIP is searched once, as Home.
 */
export function clientPlaces({ identity = [], customFields = {}, businesses = [] } = {}) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    const zip = cleanZip(p.zip);
    const state = cleanState(p.state);
    const city = cleanCity(p.city);
    if (!zip && !(city && state)) return false;
    const key = zip || `${city}|${state}`;
    if (seen.has(key)) return true;
    seen.add(key);
    out.push({ kind: p.kind, label: p.label, zip, city, state });
    return true;
  };
  let home = false;
  for (const a of rows(identity)) {
    if (a && add({ kind: "home", label: "Home", zip: a.zip, city: a.city, state: a.state })) { home = true; break; }
  }
  const cf = customFields && typeof customFields === "object" ? customFields : {};
  if (!home) home = add({ kind: "home", label: "Home", zip: cf.bp_zip, state: cf.bp_state || cf.state });
  if (!home) add({ kind: "home", label: "Home", zip: cf.zip, city: cf.city, state: cf.state });
  for (const b of rows(businesses)) {
    if (!b) continue;
    add({ kind: "business", label: text(b.name, 80) || "Your business", zip: b.zip, city: b.city, state: b.state });
  }
  return out.slice(0, MAX_PLACES);
}

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

/** The bank book's name without the scraped tail: "PNC Bank (0% BT only)" → "PNC Bank". */
export function bookBankName(name) {
  const s = text(name, 160);
  if (!s) return null;
  const cut = s.replace(/\s*\(.*$/, "").trim();
  return cut || s;
}

/* Words that stay as written when a credit union's NCUA name is put in normal case. */
const KEEP_UPPER = new Set(["FCU", "CU", "USA", "US", "TVA", "IBM", "GE", "AT&T", "UPS", "NASA"]);
/* Brand names that keep their own capitals: "ONEAZ" is OneAZ, not Oneaz. Whole words only. */
const BRAND_CASE = new Map([["ONEAZ", "OneAZ"], ["TRUWEST", "TruWest"], ["NUVISION", "NuVision"]]);
const SMALL = new Set(["of", "and", "the", "for", "at", "in", "on"]);

/** "DESERT FINANCIAL" → "Desert Financial". The NCUA lists names in capitals. */
export function creditUnionName(raw) {
  const s = text(raw, 120);
  if (!s) return null;
  if (/[a-z]/.test(s)) return s;
  return s.split(" ").map((w, i) => {
    if (BRAND_CASE.has(w)) return BRAND_CASE.get(w);
    if (KEEP_UPPER.has(w)) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL.has(lower)) return lower;
    return lower.replace(/(^|[-/.'])([a-z])/g, (m, sep, ch) => (sep === "'" ? m : sep + ch.toUpperCase()));
  }).join(" ");
}

const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "PO", "US"]);

/** "2020 N CENTRAL AVE STE 100" → "2020 N Central Ave Ste 100". Text with any lower case stays as written. */
export function tidyCaps(raw) {
  const s = text(raw, 120);
  if (!s || /[a-z]/.test(s)) return s;
  return s.split(" ").map((w) => (DIRECTIONS.has(w) || /\d/.test(w) ? w
    : w.toLowerCase().replace(/(^|[-/.'])([a-z])/g, (m, sep, ch) => (sep === "'" ? m : sep + ch.toUpperCase())))).join(" ");
}

/** "Wells Fargo Bank, National Association" → "Wells Fargo Bank". The charter tail only. */
export function bankDisplayName(raw) {
  const s = text(raw, 160);
  if (!s) return null;
  return s.replace(/,?\s+(?:National Association|N\.\s?A\.?)$/i, "").trim() || s;
}

/* ------------------------------------------------------------------ *
 * Giovanni's list → FDIC certificate / NCUA charter
 * ------------------------------------------------------------------ */

/* Each entry was looked up in the FDIC's active-bank list (api.fdic.gov, index
   locations_20261106100008) or the NCUA branch file, and is pinned by
   local-banks.test.mjs to the legal name in the bundled file. Keys are
   bankKey(bookBankName(list name)). A list bank that is not here (Eagle Bank,
   Evergreen Bank, Spirit Bank, Old Point and American National have more than
   one or no FDIC match; Elan, American Express, Barclays and Intuit have no
   branches) is simply not tied to a branch. Never guessed. */
export const LIST_INSTITUTIONS = Object.freeze({
  chase: "fdic:628",
  chasebank: "fdic:628",
  bankofamerica: "fdic:3510",
  wellsfargo: "fdic:3511",
  truist: "fdic:9846",
  pncbank: "fdic:6384",
  citizensbank: "fdic:57957",
  flagstarbank: "fdic:32541",
  flagstarbanknationalassociation: "fdic:32541",
  fnbo: "fdic:5452",
  fnboevergreen: "fdic:5452",
  firstnationalbankofomaha: "fdic:5452",
  fabandt: "fdic:16849",
  originbank: "fdic:12614",
  shoreunitedbank: "fdic:4832",
  connectonebank: "fdic:57919",
  franklinbank: "fdic:30402",
  nativeamericanbank: "fdic:27026",
  newfieldnationalbank: "fdic:14646",
  newtripolibank: "fdic:7659",
  pennianbank: "fdic:7613",
  westbank: "fdic:15614",
  bsnb: "fdic:6959",
  langleyfederalcreditunion: "ncua:1261",
  navyfederalcreditunion: "ncua:5536"
});

/** The FDIC / NCUA key for a list bank's name, or null. */
export function listInstitutionKey(name) {
  const k = bankKey(bookBankName(name));
  return k ? (LIST_INSTITUTIONS[k] || null) : null;
}

/* ------------------------------------------------------------------ *
 * Which banks count as "local"
 * ------------------------------------------------------------------ */

/* FDIC asset specialization groups (SPECGRP) that are not walk-in banks:
   1 international, 3 credit card, 6 consumer lending (FDIC BankFind
   institution_properties). */
const NOT_WALK_IN_SPECGRP = new Set([1, 3, 6]);
/* One office and $1 billion or more in assets (ASSET is in thousands).
   Measured 2026-11-07 on the FDIC list: those are online, trust, foreign and
   industrial banks (Morgan Stanley Bank, UBS Bank USA, Bank of China, Celtic
   Bank). A one-office bank under $1 billion is usually a small-town bank. */
const ONE_OFFICE_ASSET_LIMIT = 1_000_000;

/** May this FDIC bank be offered as a local bank? Credit unions: yes (member-service offices only). */
export function walkInBank(inst) {
  if (!inst || inst.kind !== "bank") return !!inst;
  if (NOT_WALK_IN_SPECGRP.has(inst.specgrp)) return false;
  if (inst.offices <= 1 && Number.isFinite(inst.asset) && inst.asset >= ONE_OFFICE_ASSET_LIMIT) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * The directory index (built once per data object)
 * ------------------------------------------------------------------ */

const INDEX = new WeakMap();

/**
 * nameVariants({ kind, name }) → the names a logo may be filed under: the name
 * itself; a bank's name without its last word "Bank" ("Western Alliance Bank" →
 * "Western Alliance", when two words stay); a credit union's name with "Credit
 * Union", "Federal Credit Union", "CU" or "FCU" after it (the NCUA leaves those off).
 */
export function nameVariants(entry) {
  const name = text(entry && entry.name);
  if (!name) return [];
  const out = [name];
  if (entry.kind === "bank") {
    const short = name.replace(/\s+Bank$/i, "").trim();
    if (short !== name && short.split(" ").length >= 2) out.push(short);
  } else if (entry.kind === "credit_union" && !/\b(credit union|f?cu)\b/i.test(name)) {
    out.push(`${name} Credit Union`, `${name} Federal Credit Union`, `${name} CU`, `${name} FCU`);
  }
  return out;
}

function pushTo(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function directoryIndex(data = DEFAULT_DATA) {
  const hit = INDEX.get(data);
  if (hit) return hit;
  const inst = new Map();
  const byZip = new Map();
  const byCity = new Map();
  const banks = data.banks || {};
  const unions = data.creditUnions || {};
  for (const [cert, row] of Object.entries(banks.institutions || {})) {
    const [legal, specgrp = null, asset = null] = Array.isArray(row) ? row : [row];
    if (!text(legal)) continue;
    inst.set(`fdic:${cert}`, { key: `fdic:${cert}`, kind: "bank", id: String(cert), legal: text(legal),
      name: bankDisplayName(legal), specgrp, asset, states: new Set(), offices: 0 });
  }
  for (const b of rows(banks.branches)) {
    const [cert, address, city, state, zip] = b;
    const i = inst.get(`fdic:${cert}`);
    if (!i || !cleanZip(zip)) continue;
    i.states.add(state);
    i.offices += 1;
    const br = { key: i.key, address, city, state, zip };
    pushTo(byZip, zip, br);
    pushTo(byCity, `${String(city).toUpperCase()}|${state}`, br);
  }
  const membership = data.membership || {};
  for (const [charter, legal] of Object.entries(unions.institutions || {})) {
    if (!text(legal)) continue;
    inst.set(`ncua:${charter}`, { key: `ncua:${charter}`, kind: "credit_union", id: String(charter), legal: text(legal),
      name: creditUnionName(legal), specgrp: null, asset: null, states: new Set(), offices: 0,
      join: joinRule(membership[charter]) });
  }
  for (const b of rows(unions.branches)) {
    const [charter, , address, city, state, zip] = b;
    const i = inst.get(`ncua:${charter}`);
    if (!i || !cleanZip(zip)) continue;
    i.states.add(state);
    i.offices += 1;
    const br = { key: i.key, address, city, state, zip };
    pushTo(byZip, zip, br);
    pushTo(byCity, `${String(city).toUpperCase()}|${state}`, br);
  }
  const centroids = data.centroids || {};
  const zips = [];
  for (const zip of byZip.keys()) {
    const p = centroids[zip];
    if (validPoint(p)) zips.push([zip, p[0], p[1]]);
  }
  /* How many institutions answer to each name a logo may be looked up by. A
     name two institutions share never picks a logo, so one bank's logo never
     lands on another. */
  const nameCount = new Map();
  for (const i of inst.values()) {
    for (const k of new Set(nameVariants(i).map(bankKey).filter(Boolean))) nameCount.set(k, (nameCount.get(k) || 0) + 1);
  }
  const out = { inst, byZip, byCity, zips, centroids, nameCount };
  INDEX.set(data, out);
  return out;
}

/* ------------------------------------------------------------------ *
 * Branches near the client's places
 * ------------------------------------------------------------------ */

/** "Same ZIP" · "1.2 mi" · "14 mi" · "Same city". */
export function distanceWords(rank, miles) {
  if (rank === 0) return "Same ZIP";
  if (Number.isFinite(miles)) return `${miles < 10 ? (Math.round(miles * 10) / 10).toFixed(1) : Math.round(miles)} mi`;
  return "Same city";
}

/**
 * branchesNear(places, { data, maxMiles }) → one entry per institution: its
 * closest branch to any of the places.
 *   rank 0  a branch in the place's own ZIP
 *   rank 1  a branch in a ZIP area within maxMiles (miles between ZIP-area centers)
 *   rank 2  same city and state, when the place's ZIP has no Census point
 */
export function branchesNear(places = [], { data = DEFAULT_DATA, maxMiles = MAX_MILES } = {}) {
  const idx = directoryIndex(data);
  const best = new Map();
  const consider = (br, place, rank, miles) => {
    const cur = best.get(br.key);
    const m = Number.isFinite(miles) ? miles : null;
    if (cur) {
      cur.branches += 1;
      const better = rank < cur.rank || (rank === cur.rank && (m ?? Infinity) < (cur.miles ?? Infinity));
      if (!better) return;
      Object.assign(cur, { rank, miles: m, branch: br, place });
      return;
    }
    best.set(br.key, { key: br.key, rank, miles: m, branch: br, place, branches: 1 });
  };
  for (const place of rows(places)) {
    const point = place.zip ? idx.centroids[place.zip] : null;
    if (validPoint(point)) {
      const latSpan = maxMiles / 69 + 0.05;
      const lonSpan = maxMiles / (69 * Math.max(0.2, Math.cos((point[0] * Math.PI) / 180))) + 0.05;
      for (const [zip, lat, lon] of idx.zips) {
        if (Math.abs(lat - point[0]) > latSpan || Math.abs(lon - point[1]) > lonSpan) continue;
        const same = zip === place.zip;
        const miles = same ? 0 : greatCircleMiles(point, [lat, lon]);
        if (miles === null || miles > maxMiles) continue;
        for (const br of idx.byZip.get(zip) || []) consider(br, place, same ? 0 : 1, miles);
      }
      continue;
    }
    for (const br of (place.zip && idx.byZip.get(place.zip)) || []) consider(br, place, 0, null);
    if (place.city && place.state) {
      for (const br of idx.byCity.get(`${place.city}|${place.state}`) || []) {
        if (br.zip !== place.zip) consider(br, place, 2, null);
      }
    }
  }
  return [...best.values()];
}

/* ------------------------------------------------------------------ *
 * Merging with Giovanni's list
 * ------------------------------------------------------------------ */

function sourceFor(inst) {
  return inst.kind === "bank"
    ? { label: LOCAL_BANK_SOURCES.banks.label, ref: `FDIC cert ${inst.id} · ${fdicData.source.index || "locations"}` }
    : { label: LOCAL_BANK_SOURCES.credit_unions.label, ref: `NCUA charter ${inst.id} · call report ${ncuaData.source.asOf}` };
}

/**
 * nearbyInstitutions(places, { recommended, leftOut, data, maxMiles }) → the list
 * shown under "Branches near you", nearest first.
 *
 * Kept: a plan bank from Giovanni's list (recommended_banks, tied by
 * LIST_INSTITUTIONS) with a branch near you, and a local bank or credit union
 * (every branch in your home and business states, a walk-in bank).
 * Left out: a bank the book says you cannot join or that needs no account
 * (banks_left_out), a credit union only one group can join, and big banks
 * that are on no list and not local.
 */
export function nearbyInstitutions(places = [], { recommended = [], leftOut = [], data = DEFAULT_DATA, maxMiles = MAX_MILES } = {}) {
  const idx = directoryIndex(data);
  const states = new Set(rows(places).map((p) => p.state).filter(Boolean));
  const blocked = new Set(rows(leftOut).map((x) => listInstitutionKey(x && x.name)).filter(Boolean));
  /* Giovanni's list as the bank match keeps it for this client: recommended_banks
     (active, state-gated, wants an account first). A list bank outside that, for
     example one the book says does not serve your state, is not marked "on our list". */
  const onList = new Map();
  for (const r of rows(recommended)) {
    const key = listInstitutionKey(r && r.name);
    if (key && !onList.has(key)) onList.set(key, { lender_id: r.lender_id || null, name: text(r.name) });
  }
  const out = [];
  for (const hit of branchesNear(places, { data, maxMiles })) {
    const inst = idx.inst.get(hit.key);
    if (!inst || blocked.has(hit.key)) continue;
    const list = onList.get(hit.key) || null;
    const local = states.size > 0 && inst.states.size > 0 && [...inst.states].every((s) => states.has(s));
    if (!list && !(local && walkInBank(inst))) continue;
    if (!list && inst.join === "one_group") continue;
    const near = hit.place || {};
    out.push({
      key: inst.key,
      kind: inst.kind,
      name: list ? list.name : inst.name,
      legal_name: inst.legal,
      on_list: !!list,
      lender_id: list ? list.lender_id : null,
      local,
      branch: { address: tidyCaps(hit.branch.address), city: tidyCaps(hit.branch.city), state: hit.branch.state, zip: hit.branch.zip },
      miles: hit.miles === null ? null : Math.round(hit.miles * 10) / 10,
      rank: hit.rank,
      distance_text: distanceWords(hit.rank, hit.miles),
      near: { kind: near.kind || null, label: near.label || null },
      branches_near: hit.branches,
      join_check: inst.kind === "credit_union" && inst.join !== "community",
      source: sourceFor(inst)
    });
  }
  out.sort((a, b) => a.rank - b.rank || (a.miles ?? Infinity) - (b.miles ?? Infinity) ||
    Number(b.on_list) - Number(a.on_list) || a.name.localeCompare(b.name));
  return out;
}

function sameName(a, b) {
  const x = String(a || "").trim().toLowerCase();
  return !!x && x === String(b || "").trim().toLowerCase();
}

/* The same match bankSteps uses (src/waypoints/blueprint-path.mjs sameBank). */
function onTracker(rec, rel) {
  if (rec?.lender_id && rel?.lender_id && String(rec.lender_id) === String(rel.lender_id)) return true;
  return sameName(rec?.name, rel?.bank_key) || sameName(rec?.name, rel?.bank);
}

/**
 * nearWords(n) → the one line a plan row says about where the bank is:
 *   "Branch about 0.4 mi from your home ZIP."  "Local credit union in the same ZIP as Cedar Grove LLC."
 * Miles run between ZIP-area centers, never from a street, so a number says "about".
 */
export function nearWords(n) {
  if (!n) return null;
  const what = n.on_list ? "Branch" : (n.kind === "credit_union" ? "Local credit union" : "Local bank");
  const business = n.near && n.near.kind === "business" && n.near.label ? n.near.label : null;
  const place = business || "your home";
  if (n.rank === 0) return `${what} in the same ZIP as ${place}.`;
  if (n.rank === 2) return `${what} in the same city as ${place}.`;
  return `${what}${n.on_list ? "" : ","} about ${n.distance_text} from ${business ? `the ${business} ZIP` : "your home ZIP"}.`;
}

/** A local find in the recommended_banks shape bankSteps reads. No book facts: deposit and seasoning read "not set". */
function localRecommendation(n) {
  return {
    lender_id: null, name: n.name, kind: n.kind, products: [], lender_table: null, serves_state: null,
    lane: null, tier: null, minimum_deposit_cents: null, seasoning_days: null, logo: null,
    why: [], relationship_steps: [], source: n.source, local: true, near: { text: nearWords(n), miles: n.miles }
  };
}

/**
 * planCandidates({ recommended, relationships, nearby, max }) → the banks the
 * plan considers, in plan order, cut so bankSteps never pushes a tracker bank
 * off: [{ rec, near, group }] with group list_near | local | list.
 */
export function planCandidates({ recommended = [], relationships = [], nearby = [], max = PLAN_MAX } = {}) {
  const live = rows(relationships).filter((r) => r && r.status !== "skipped");
  const skipped = rows(relationships).filter((r) => r && r.status === "skipped");
  const near = new Map(rows(nearby).map((n) => [n.key, n]));
  const listNear = [];
  const listFar = [];
  const listKeys = new Set();
  for (const rec of rows(recommended)) {
    if (!rec || !text(rec.name)) continue;
    if (skipped.some((s) => onTracker(rec, s))) continue;
    const key = listInstitutionKey(rec.name);
    if (key) listKeys.add(key);
    const n = key ? near.get(key) : null;
    const item = { rec: n ? { ...rec, near: { text: nearWords(n), miles: n.miles } } : rec, near: n || null };
    (n ? listNear : listFar).push({ ...item, group: n ? "list_near" : "list" });
  }
  const locals = rows(nearby)
    .filter((n) => !n.on_list && n.local && !listKeys.has(n.key))
    .map((n) => ({ rec: localRecommendation(n), near: n, group: "local" }))
    .filter((c) => !skipped.some((s) => onTracker(c.rec, s)));
  const ordered = [...listNear, ...locals, ...listFar];
  const tracked = (c) => live.some((r) => onTracker(c.rec, r));
  const unmatched = live.filter((r) => !ordered.some((c) => onTracker(c.rec, r))).length;
  const room = Math.max(0, max - unmatched);
  let trackedLeft = ordered.filter(tracked).length;
  const out = [];
  for (const c of ordered) {
    if (out.length >= room) break;
    if (tracked(c)) { out.push(c); trackedLeft -= 1; continue; }
    if (room - out.length > trackedLeft) out.push(c);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Logos: Plaid, then the bank book, then the name only
 * ------------------------------------------------------------------ */

/* The asks for one bank. A list bank asks by its lender id and its list name.
   Any other bank asks by each of its name variants that no other institution
   answers to, so one bank's logo never lands on another. */
export function logoAsks(entry, data = DEFAULT_DATA) {
  const idx = directoryIndex(data);
  const name = text(entry && entry.name);
  if (!name) return [];
  if (entry.lender_id || entry.on_list) return [{ lenderId: entry.lender_id || null, name }];
  return nameVariants(entry)
    .filter((n) => { const k = bankKey(n); return !!k && (idx.nameCount.get(k) || 0) <= 1; })
    .map((n) => ({ name: n }));
}

/** One findLogos call for every entry; each gets { logo, logo_source }. Never throws. */
export async function logosFor(db, { orgId, entries = [], data = DEFAULT_DATA, find = findLogos } = {}) {
  const plan = entries.map((e) => logoAsks(e, data));
  const flat = plan.flat();
  let found = [];
  try {
    found = flat.length ? await find(db, { orgId, banks: flat }) : [];
  } catch {
    found = [];
  }
  let at = 0;
  return plan.map((asks) => {
    const got = asks.map(() => found[at++] || { logo: null, logo_source: null });
    return got.find((g) => g.logo_source === "plaid" && g.logo) || got.find((g) => g.logo) || { logo: null, logo_source: null };
  });
}

/* ------------------------------------------------------------------ *
 * The read
 * ------------------------------------------------------------------ */

/* ZIP, city and state only. The street and the SSN are never selected. */
export const HOME_SQL = `SELECT COALESCE(e.a->>'postalCode', e.a->>'postal_code', e.a->>'zip', e.a->>'zipCode', e.a->>'zip_code') AS zip,
       COALESCE(e.a->>'city', e.a->>'addressCity', e.a->>'address_city') AS city,
       COALESCE(e.a->>'state', e.a->>'addressState', e.a->>'address_state') AS state
  FROM pii_identity p
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.addresses) = 'array' THEN p.addresses ELSE '[]'::jsonb END)
       WITH ORDINALITY AS e(a, n)
 WHERE p.org_id = $1::uuid AND p.client_id = $2::uuid
 ORDER BY e.n
 LIMIT 5`;

export const PERSON_SQL = `SELECT custom_fields->'blueprint_business_plans'->>'postalCode' AS bp_zip,
       custom_fields->'blueprint_business_plans'->>'homeState' AS bp_state,
       COALESCE(custom_fields->>'postal_code', custom_fields->>'zip', custom_fields->>'home_zip') AS zip,
       COALESCE(custom_fields->>'home_city', custom_fields->>'city') AS city,
       COALESCE(custom_fields->>'home_state', custom_fields->>'state') AS state
  FROM clients WHERE org_id = $1::uuid AND id = $2::uuid`;

export const BUSINESS_PLACES_SQL = `SELECT id, name,
       COALESCE(entity_data->>'postal_code', entity_data->>'zip', entity_data->>'postalCode') AS zip,
       entity_data->>'city' AS city,
       COALESCE(entity_data->>'state', entity_data->>'business_state', entity_data->>'address_state') AS state
  FROM businesses WHERE org_id = $1::uuid AND client_id = $2::uuid
 ORDER BY created_at ASC LIMIT 10`;

/** readPlaces(db, { orgId, clientId }) → the client's places. Every query carries org_id and client_id. */
export async function readPlaces(db, { orgId, clientId }) {
  const [home, person, biz] = await Promise.all([
    db.query(HOME_SQL, [orgId, clientId]),
    db.query(PERSON_SQL, [orgId, clientId]),
    db.query(BUSINESS_PLACES_SQL, [orgId, clientId])
  ]);
  return clientPlaces({ identity: home.rows, customFields: (person.rows && person.rows[0]) || {}, businesses: biz.rows });
}

function addMonths(day, n) {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * buildLocalBanks({ payload, places, today, data }) → { local_banks, deposit_plan }
 * Pure: the bank read's payload plus the client's places. Logos are added after.
 */
export function buildLocalBanks({ payload = {}, places = [], today, data = DEFAULT_DATA } = {}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(today || "")) ? today : new Date().toISOString().slice(0, 10);
  const recommended = rows(payload.recommended_banks);
  const relationships = rows(payload.relationships);
  const window = { from: day, to: addMonths(day, PLAN_MONTHS), months: PLAN_MONTHS };
  const base = {
    places: places.map((p) => ({ kind: p.kind, label: p.label, zip: p.zip, city: p.city, state: p.state })),
    radius_miles: MAX_MILES,
    window,
    plan_max: PLAN_MAX,
    sources: LOCAL_BANK_SOURCES
  };
  if (!places.length) {
    return {
      local_banks: { ...base, status: "needs_address", nearby: [], nearby_total: 0, plan: [] },
      deposit_plan: rows(payload.deposit_plan)
    };
  }
  const nearby = nearbyInstitutions(places, { recommended, leftOut: payload.banks_left_out, data });
  const candidates = planCandidates({ recommended, relationships, nearby, max: PLAN_MAX });
  const steps = bankSteps({ recommended: candidates.map((c) => c.rec), relationships, maxBanks: PLAN_MAX });
  const planRows = depositPlanRows(steps).map((r) => {
    const c = candidates.find((x) => (r.lender_id && x.rec.lender_id && String(x.rec.lender_id) === String(r.lender_id)) ||
      sameName(x.rec.name, r.name)) || null;
    const n = c ? c.near : null;
    const local = !!(c && c.group === "local");
    return {
      ...r,
      kind: n ? n.kind : r.kind,
      group: c ? c.group : "tracker",
      on_list: c ? !local : recommended.some((rec) => sameName(rec.name, r.name)),
      local,
      join_check: !!(n && n.join_check),
      near: n ? { text: nearWords(n), distance_text: n.distance_text, miles: n.miles, label: n.near.label, branch: n.branch } : null,
      reason: local ? nearWords(n) : r.reason,
      reason_source: local ? n.source : r.reason_source
    };
  });
  return {
    local_banks: {
      ...base,
      status: nearby.length ? "ready" : "none_near",
      nearby: nearby.slice(0, NEARBY_SHOWN),
      nearby_total: nearby.length,
      plan: planRows.map((r) => ({ name: r.name, group: r.group, local: r.local })),
      /* The plan banks in the recommended_banks shape, for a reader that runs bankSteps itself (the Blueprint path). */
      recommended: candidates.map((c) => c.rec)
    },
    deposit_plan: planRows
  };
}

/**
 * attachLocalBanks(db, { orgId, clientId, payload, now }) → the bank read's payload
 * with `local_banks` and the merged `deposit_plan`. Read only. Never throws:
 * a failure keeps the payload's own deposit_plan and says local banks are unavailable.
 */
export async function attachLocalBanks(db, { orgId, clientId, payload, now = new Date(), data = DEFAULT_DATA, find = findLogos, read = readPlaces } = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const today = new Date(now).toISOString().slice(0, 10);
  try {
    const places = await read(db, { orgId, clientId });
    const built = buildLocalBanks({ payload, places: rows(places), today, data });
    const lb = built.local_banks;
    /* No address: nothing near to show, and the read's own plan goes out as it came. */
    if (lb.status === "needs_address") return { ...payload, local_banks: lb };
    const entries = [...lb.nearby, ...built.deposit_plan];
    const logos = await logosFor(db, { orgId, entries, data, find });
    lb.nearby = lb.nearby.map((n, i) => ({ ...n, logo: logos[i].logo, logo_source: logos[i].logo_source }));
    const off = lb.nearby.length;
    const plan = built.deposit_plan.map((r, i) => {
      const l = logos[off + i];
      /* A logo the read already chose stays when this one found none. */
      const logo = l.logo || r.logo || null;
      return { ...r, logo, logo_alt: logo ? `${r.name} logo` : null, logo_source: l.logo ? l.logo_source : (r.logo ? "bank_book" : null) };
    });
    return { ...payload, local_banks: lb, deposit_plan: plan };
  } catch (e) {
    console.error("banks: local banks failed", e && e.message ? e.message : e);
    return {
      ...payload,
      local_banks: { status: "unavailable", places: [], nearby: [], nearby_total: 0, plan: [], radius_miles: MAX_MILES,
        window: { from: today, to: addMonths(today, PLAN_MONTHS), months: PLAN_MONTHS }, plan_max: PLAN_MAX, sources: LOCAL_BANK_SOURCES }
    };
  }
}

export default attachLocalBanks;
