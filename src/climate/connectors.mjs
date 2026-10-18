import { logoPathOrPlaceholder } from "../lenders/resolve-logo.mjs";
import { defaultOrgId } from "../pulse/daily-pulse.mjs";
import {
  STATE_CENTROIDS,
  STATE_FIPS,
  blsKey,
  computeTtlExpiry,
  fredKey,
  isExpired,
  mapsServerKey,
  nowIso
} from "./config.mjs";

/** Public CRM lender row for /api/climate — no staff-only or invented odds. */
export function mapClimateLender(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    product_name: row.product_name ?? null,
    lender_table: row.lender_table,
    eligible_states: row.eligible_states ?? null,
    application_url: row.application_url ?? null,
    logo_path: logoPathOrPlaceholder(row.logo_path),
    priority_tier: row.priority_tier == null ? null : Number(row.priority_tier),
    bureaus_pulled: row.bureaus_pulled ?? null,
    type: "lender"
  };
}

export async function pullCrmLenders(db) {
  const now = nowIso();
  const cacheKey = "connector:crm:lenders";
  const { entry: cached, expired } = await getCached(cacheKey);
  const ttl_expires_at = computeTtlExpiry(now, "daily");
  if (cached && !expired) return { ...cached, stale: false, fetch_status: "cache" };
  if (!db || typeof db.query !== "function") {
    return { updated_at: now, ttl_expires_at, lenders: [], fetch_status: "no_db", stale: true };
  }
  try {
    const orgId = await defaultOrgId(db);
    if (!orgId) throw new Error("default org missing");
    const { rows } = await db.query(
      `SELECT id, lender_table, name, product_name, eligible_states,
              application_url, logo_path, priority_tier, bureaus_pulled
         FROM lenders
        WHERE org_id = $1::uuid AND active = $2 AND COALESCE(is_demo, false) = false
        ORDER BY priority_tier NULLS LAST, lower(name), id
        LIMIT 5000`,
      [orgId, true]
    );
    const lenders = rows.map(mapClimateLender).filter(Boolean);
    const record = {
      updated_at: now,
      ttl_expires_at,
      lenders,
      fetch_status: "fetched",
      stale: false
    };
    await setCached(cacheKey, record);
    return record;
  } catch {
    if (cached) return { ...cached, stale: true, fetch_status: "lkg" };
    return { updated_at: now, ttl_expires_at, lenders: [], fetch_status: "fallback", stale: true };
  }
}

const memory = new Map();

export async function getCached(key, now = new Date()) {
  const entry = memory.get(key);
  if (!entry) return { entry: null, expired: true };
  return { entry, expired: isExpired(entry.ttl_expires_at, now) };
}

export async function setCached(key, entry) {
  memory.set(key, entry);
  return entry;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(id) };
}

const FRED_SERIES = [
  { id: "DGS10", cadence: "daily", fallback: 4.0 },
  { id: "EFFR", cadence: "daily", fallback: 5.0, alt: "FEDFUNDS" },
  { id: "BAMLC0A4CBBBEY", cadence: "daily", fallback: 5.5 },
  { id: "CPIAUCSL", cadence: "monthly", fallback: 3.0, compute: "yoy", limit: 14 },
  { id: "UMCSENT", cadence: "monthly", fallback: 70 },
  { id: "NFIBBUSI", cadence: "monthly", fallback: 95 }
];

async function fetchFredObservation(target) {
  const key = fredKey();
  const { id, alt, compute, limit = compute === "yoy" ? 14 : 1 } = target;
  const { signal, cancel } = withTimeout(6000);
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=${limit}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`FRED ${id} ${res.status}`);
    const json = await res.json();
    const observations = json.observations || [];
    if (!observations.length && alt) return fetchFredObservation({ ...target, id: alt, alt: null });
    if (compute === "yoy" && observations.length >= 13) {
      const latest = parseFloat(observations[0].value);
      const prior = parseFloat(observations[12].value);
      const yoy = prior ? ((latest - prior) / prior) * 100 : latest;
      return { series_id: id, observations: [{ date: observations[0].date, value: yoy }] };
    }
    const obs = observations[0];
    if (!obs) throw new Error(`FRED ${id} empty`);
    return { series_id: id, observations: [{ date: obs.date, value: parseFloat(obs.value) }] };
  } finally {
    cancel();
  }
}

export async function pullFred() {
  const now = nowIso();
  const series = {};
  let stale = false;
  for (const target of FRED_SERIES) {
    const cacheKey = `connector:fred:${target.id}`;
    const { entry: cached, expired } = await getCached(cacheKey);
    const ttl_expires_at = computeTtlExpiry(now, target.cadence);
    let record = cached;
    if (!cached || expired) {
      try {
        if (!fredKey()) throw new Error("FRED_API_KEY unset");
        const fetched = await fetchFredObservation(target);
        record = { ...fetched, updated_at: now, ttl_expires_at, fetch_status: "fetched", stale: false };
        await setCached(cacheKey, record);
      } catch {
        record = cached
          ? { ...cached, stale: true, fetch_status: "lkg" }
          : {
            series_id: target.id,
            observations: [{ date: now, value: target.fallback }],
            updated_at: now,
            ttl_expires_at,
            fetch_status: "fallback",
            stale: true
          };
        stale = true;
        if (!cached) await setCached(cacheKey, record);
      }
    } else {
      record = { ...record, stale: false, fetch_status: "cache" };
    }
    series[target.id] = record;
  }
  return { updated_at: now, fetch_status: stale ? "fallback" : "fetched", series, stale };
}

export async function pullBls(states = Object.keys(STATE_FIPS)) {
  const now = nowIso();
  const cacheKey = "connector:bls:laus";
  const { entry: cached, expired } = await getCached(cacheKey);
  const ttl_expires_at = computeTtlExpiry(now, "monthly");
  if (cached && !expired) return { ...cached, stale: false, fetch_status: "cache" };
  try {
    const payload = {
      seriesid: states.map((code) => `LAUST${STATE_FIPS[code]}0000000003`).filter(Boolean)
    };
    if (blsKey()) payload.registrationkey = blsKey();
    const { signal, cancel } = withTimeout(8000);
    const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal
    });
    cancel();
    if (!res.ok) throw new Error(`BLS ${res.status}`);
    const json = await res.json();
    const entries = (json.Results?.series || []).flatMap((seriesEntry) => {
      const stateFips = seriesEntry.seriesID.slice(5, 7);
      const state = Object.entries(STATE_FIPS).find(([, f]) => f === stateFips)?.[0];
      const value = parseFloat(seriesEntry.data?.[0]?.value);
      if (!state) return [];
      return [{ state_code: state, unemployment_rate_pct: Number.isFinite(value) ? value : null, date: now }];
    });
    if (!entries.length) throw new Error("BLS empty");
    const record = { updated_at: now, ttl_expires_at, states: entries, fetch_status: "fetched", stale: false };
    await setCached(cacheKey, record);
    return record;
  } catch {
    if (cached) return { ...cached, stale: true, fetch_status: "lkg" };
    const fallbackStates = states.map((state, idx) => ({
      state_code: state,
      unemployment_rate_pct: Number((3 + (idx % 5) * 0.4).toFixed(1)),
      date: now
    }));
    const fallback = { updated_at: now, ttl_expires_at, states: fallbackStates, fetch_status: "fallback", stale: true };
    await setCached(cacheKey, fallback);
    return fallback;
  }
}

function mapFdicRow(row) {
  const r = row.data || row;
  return {
    institution_id: String(r.UNINUM || r.CERT || r.IDRSSD || r.NAME),
    legal_name: r.NAME,
    state_code: r.STALP,
    city: r.CITY,
    zip: r.ZIP,
    total_deposits: Number.parseFloat(r.DEP),
    cds_balance: Number.parseFloat(r.TCD || 0) || null,
    total_assets: Number.parseFloat(r.ASSET),
    net_interest_margin: Number.parseFloat(r.NIMY || r.NIMYTD || 0) || null,
    location: null
  };
}

export async function pullFdic(limit = 50) {
  const now = nowIso();
  const cacheKey = "connector:fdic:institutions";
  const { entry: cached, expired } = await getCached(cacheKey);
  const ttl_expires_at = computeTtlExpiry(now, "quarterly");
  if (cached && !expired) return { ...cached, stale: false, fetch_status: "cache" };
  try {
    const fields = ["UNINUM", "CERT", "IDRSSD", "NAME", "STALP", "CITY", "ZIP", "ASSET", "DEP", "NIMY", "NIMYTD"].join(",");
    const url = `https://banks.data.fdic.gov/api/institutions?filters=ACTIVE%3A1&fields=${fields}&sort_by=ASSET&sort_order=desc&limit=${limit}`;
    const { signal, cancel } = withTimeout(8000);
    const res = await fetch(url, { signal });
    cancel();
    if (!res.ok) throw new Error(`FDIC ${res.status}`);
    const json = await res.json();
    const banks = (json.data || []).map(mapFdicRow).filter((b) => b.state_code);
    const record = { updated_at: now, ttl_expires_at, banks, fetch_status: "fetched", stale: false };
    await setCached(cacheKey, record);
    return record;
  } catch {
    if (cached) return { ...cached, stale: true, fetch_status: "lkg" };
    const banks = [
      { institution_id: "1001", legal_name: "Desert First Bank", state_code: "AZ", city: "Phoenix", total_deposits: 1.25e9, cds_balance: 3.2e8, total_assets: 2.1e9, net_interest_margin: 3.1, location: null },
      { institution_id: "2001", legal_name: "Pacific Horizon Bank", state_code: "CA", city: "Los Angeles", total_deposits: 2.25e9, cds_balance: 4.5e8, total_assets: 4e9, net_interest_margin: 2.9, location: null },
      { institution_id: "4001", legal_name: "Lone Star National", state_code: "TX", city: "Austin", total_deposits: 1.4e9, cds_balance: 3e8, total_assets: 2.5e9, net_interest_margin: 3.3, location: null }
    ];
    const record = { updated_at: now, ttl_expires_at, banks, fetch_status: "fallback", stale: true };
    await setCached(cacheKey, record);
    return record;
  }
}

function stateFromText(query) {
  const upper = String(query || "").toUpperCase();
  const match = upper.match(/\b([A-Z]{2})\b/);
  if (match && STATE_CENTROIDS[match[1]]) return match[1];
  for (const [code, name] of Object.entries({
    ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
    COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",
    HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS",
    KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA",
    MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT",
    NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",
    OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX",
    UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",
    WISCONSIN: "WI", WYOMING: "WY"
  })) {
    if (upper.includes(code)) return name;
  }
  return null;
}

/* The two geocoder calls. One fetch per provider, shared by geocode() below
   and by verifyStreetAddress(). Each answers:
     { status: "hit", hit }  the provider returned a first result
     { status: "none" }      the provider answered and found nothing
     { status: "error" }     the provider did not answer usably (down, slow,
                             refused, bad body)
     { status: "off" }       Google only: no key set */
async function googleLookup(query, timeoutMs = 6000) {
  const key = mapsServerKey();
  if (!key) return { status: "off" };
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:US&key=${encodeURIComponent(key)}`;
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal });
    cancel();
    if (!res.ok) return { status: "error" };
    const json = await res.json();
    if (json.status === "ZERO_RESULTS") return { status: "none" };
    if (json.status && json.status !== "OK") return { status: "error" };
    const hit = json.results?.[0];
    return hit ? { status: "hit", hit } : { status: "none" };
  } catch {
    cancel();
    return { status: "error" };
  }
}

async function censusLookup(query, timeoutMs = 6000) {
  // The geographies endpoint returns the same matched address and point as the
  // locations endpoint, plus the county the lending-climate map needs.
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal, headers: { "User-Agent": "fundhub-climate/1.0" } });
    cancel();
    if (!res.ok) return { status: "error" };
    const json = await res.json();
    const matches = json.result?.addressMatches;
    if (!Array.isArray(matches)) return { status: "error" };
    return matches[0] ? { status: "hit", hit: matches[0] } : { status: "none" };
  } catch {
    cancel();
    return { status: "error" };
  }
}

async function geocodeGoogle(query) {
  const found = await googleLookup(query);
  if (found.status !== "hit") return null;
  const hit = found.hit;
  const stateComp = (hit.address_components || []).find((c) => c.types.includes("administrative_area_level_1"));
  const countyComp = (hit.address_components || []).find((c) => c.types.includes("administrative_area_level_2"));
  const stateCode = stateComp?.short_name;
  return {
    ok: true,
    provider: "google",
    stateCode: STATE_CENTROIDS[stateCode] ? stateCode : stateFromText(query),
    county: countyComp?.long_name || null,
    lat: hit.geometry?.location?.lat,
    lng: hit.geometry?.location?.lng,
    formatted: hit.formatted_address
  };
}

async function geocodeCensus(query) {
  const found = await censusLookup(query);
  if (found.status !== "hit") return null;
  const match = found.hit;
  const stateCode = match.addressComponents?.state;
  const county = match.geographies?.Counties?.[0]?.NAME || null;
  return {
    ok: true,
    provider: "census",
    stateCode: STATE_CENTROIDS[stateCode] ? stateCode : stateFromText(query),
    county,
    lat: match.coordinates?.y,
    lng: match.coordinates?.x,
    formatted: match.matchedAddress
  };
}

/* A Google hit proves a street address only at street level. A hit on the
   road, the ZIP or the town is Google guessing near a place that is not there. */
const GOOGLE_STREET_TYPES = new Set(["street_address", "premise", "subpremise"]);

function googleHitIsStreet(hit) {
  return Array.isArray(hit?.types) && hit.types.some((t) => GOOGLE_STREET_TYPES.has(t));
}

/**
 * verifyStreetAddress — does this typed US street address exist?
 * For the $297 pull form (src/slo/address-check.mjs, owner-set 2026-09-22).
 *
 * The same two lookups as geocode(), no new outbound call: Google when
 * GOOGLE_MAPS_API_KEY is set, then the free US Census geocoder. Never falls
 * back to a state centroid — a centroid proves nothing about a street.
 *
 *   "match"        either provider found the street address
 *   "no_match"     a provider answered and neither found it
 *   "unavailable"  no provider answered (down, slow, refused)
 *
 * Answers of "match" / "no_match" are remembered in the same in-memory cache
 * as geocode(), under their own key.
 */
export async function verifyStreetAddress(query, { timeoutMs = 4000 } = {}) {
  const q = String(query || "").trim();
  if (!q) return "unavailable";
  const cacheKey = `verify:${q.toLowerCase()}`;
  if (memory.has(cacheKey)) return memory.get(cacheKey);

  let answered = false;
  const google = await googleLookup(q, timeoutMs);
  if (google.status === "hit" && googleHitIsStreet(google.hit)) {
    memory.set(cacheKey, "match");
    return "match";
  }
  if (google.status === "hit" || google.status === "none") answered = true;

  const census = await censusLookup(q, timeoutMs);
  if (census.status === "hit") {
    memory.set(cacheKey, "match");
    return "match";
  }
  if (census.status === "none") answered = true;

  if (!answered) return "unavailable";
  memory.set(cacheKey, "no_match");
  return "no_match";
}

export async function geocode(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const exact = q.toUpperCase();
  if (STATE_CENTROIDS[exact]) {
    return { ok: true, provider: "centroid", stateCode: exact, county: null, ...STATE_CENTROIDS[exact] };
  }
  const cacheKey = `geocode:${q.toLowerCase()}`;
  const cached = memory.get(cacheKey);
  if (cached) return cached;
  const google = await geocodeGoogle(q);
  const census = google || await geocodeCensus(q);
  const stateCode = census?.stateCode || stateFromText(q);
  const fallback = stateCode && STATE_CENTROIDS[stateCode]
    ? { ok: true, provider: census?.provider || "centroid", stateCode, county: census?.county || null, ...STATE_CENTROIDS[stateCode] }
    : null;
  const result = census?.lat ? census : fallback;
  if (result) memory.set(cacheKey, result);
  return result;
}
