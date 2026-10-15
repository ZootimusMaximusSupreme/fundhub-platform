// Finish-853 batch 22, generation 2: live page reads for two journey rows (Flow lane).
//
// A journey step that names what a public page shows is judged by one read of the live page, the way a
// visitor's browser would get it: GET only, same site only, no login, nothing written, nothing sent.
//
//   journey:climate-lead-magnet-intended#2-reading-and-map
//       "Today's reading: national number and a map of 51 states from GET /api/climate"
//       Reads GET /api/climate (the data the page paints) and the scripts the live /climate/ page loads
//       (the page draws its map from a list of state outlines inside them). Red when the page has fewer
//       outlines than the data door has states. Today the page ships five.
//
//   journey:fh-consulting-intended#5-request-enrollment
//       "the form opens an email to the support address; it takes no card"
//       Reads the live /consulting/ page. Green when its form opens an email (mailto) to the same support
//       address the page lists, and the page has no card field, no payment script and no form that posts
//       away, and says nothing is charged.
//
// A failed read is a `skip` with the reason, never a PASS. A page that answers and does not hold what the
// step says is a FAIL, in plain words.
//
// The judges are pure (text in, verdict out) so the tests can hold them to the page files in this repo, which
// are the files the live site serves, and to changed copies of them.

export const FIN_B22_PAGE_LANE = "src/pulse/coverage/gap-catalog-flow.mjs";
export const FIN_B22_PAGE_TEST = "src/pulse/catalog/proofs/fin-b22-page-reads.test.mjs";

export const CLIMATE_READING_SURFACE = "journey:climate-lead-magnet-intended#2-reading-and-map";
export const CONSULTING_REQUEST_SURFACE = "journey:fh-consulting-intended#5-request-enrollment";

export const DEFAULT_BASE_URL = "https://fundhub.ai";
export const READ_TIMEOUT_MS = 6000;
/** All of one run's reads together. Netlify cuts a pulse step at 26 seconds, and a lane stays under 20. */
export const RUN_TIMEOUT_MS = 12000;
/** The most page scripts one read will fetch. The live /climate/ page loads seven; most are the framework. */
export const MAX_SCRIPTS = 8;

/** The 50 states and DC, the same 51 the climate data door sends. */
export const STATE_CODES = Object.freeze([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
  "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

const VALID_CODE = new Set(STATE_CODES);

function verdict(surface, status, detail, suggestedFix = null) {
  return { id: `flow:journey:${surface}`, status, detail, suggestedFix };
}

// ── climate: the reading and the map ─────────────────────────────────────────

/** A state outline in page script: "AZ":"M120,200 L200,200 ..." (quotes may be escaped inside a string). */
const OUTLINE = /\\?["']([A-Z]{2})\\?["']\s*:\s*\\?["'][Mm][-\d.,\sLlHhVvCcSsQqTtAaZz]{6,}/g;

/** The state codes that have an outline in this script text. */
export function outlinesIn(text) {
  const found = new Set();
  for (const m of String(text || "").matchAll(OUTLINE)) if (VALID_CODE.has(m[1])) found.add(m[1]);
  return found;
}

const PLAIN_LIST = (codes, max = 8) => {
  const list = [...codes].sort();
  return list.length > max ? `${list.slice(0, max).join(", ")} and ${list.length - max} more` : list.join(", ");
};

/**
 * Judge the live climate reading.
 *   api       the parsed JSON the data door sent (or null when it did not parse)
 *   outlines  the Set of state codes the page's scripts hold an outline for
 */
export function judgeClimateReading({ api, outlines }) {
  const surface = CLIMATE_READING_SURFACE;
  const fix = "Put an outline for every state in the climate page's map data, so the map draws all 51. Do not auto-fix. Chris fixes reds.";
  if (!api || typeof api !== "object" || api.ok !== true || !Array.isArray(api.states)) {
    return verdict(surface, "FAIL",
      `${surface}: the climate data door did not send a good reading (no ok flag or no list of states), so the page has nothing to paint.`,
      "Open GET /api/climate and find why it did not answer ok with a list of states. Do not auto-fix. Chris fixes reds.");
  }
  const sent = new Set(api.states.map((s) => String(s?.state || "")).filter((code) => VALID_CODE.has(code)));
  if (sent.size !== STATE_CODES.length) {
    const missing = STATE_CODES.filter((code) => !sent.has(code));
    return verdict(surface, "FAIL",
      `${surface}: the climate data door sent ${sent.size} of 51 states (missing ${PLAIN_LIST(missing)}).`,
      "Find why the data door dropped a state. Do not auto-fix. Chris fixes reds.");
  }
  const drawn = [...sent].filter((code) => outlines.has(code));
  if (drawn.length !== sent.size) {
    const missing = [...sent].filter((code) => !outlines.has(code));
    return verdict(surface, "FAIL",
      `${surface}: the live /climate/ page draws ${drawn.length} of ${sent.size} state outlines. There is no outline for ${missing.length} states (${PLAIN_LIST(missing)}), so those states cannot show on the map.`,
      fix);
  }
  const raw = api.national ? api.national.score : null;
  const score = raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
  return verdict(surface, "PASS",
    `${surface}: the live /climate/ page draws all ${sent.size} state outlines the data door sends, and the data door sends ${score === null ? "no national number (the page shows a dash)" : `a national number of ${score}`}.`);
}

// ── consulting: the request form ─────────────────────────────────────────────

const CARD_FIELD = /<(?:input|select|textarea)\b[^>]*\b(?:name|id|autocomplete)\s*=\s*["'][^"']*(?:card|cc-|cvc|cvv|expir)[^"']*["']/i;
const PAYMENT_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:stripe|paypal|square|braintree|authorize\.net|fanbasis|commas|checkout)[^"']*["']/i;
const NO_CHARGE_WORDS = /nothing is charged|you are not charged|not a purchase|does not (?:take|charge) a card|this page does not charge/i;

/** Judge the live /consulting/ request form from the page text. */
export function judgeConsultingRequest(html) {
  const surface = CONSULTING_REQUEST_SURFACE;
  const text = String(html || "");
  const wrong = [];

  const hasForm = /<form\b/i.test(text);
  if (!hasForm) wrong.push("the page has no request form");

  const submits = /addEventListener\(\s*["']submit["']/i.test(text);
  const target = /location(?:\.href)?\s*=\s*["']mailto:([^"'?\s<>]+)/i.exec(text);
  if (hasForm && !(submits && target)) wrong.push("the form's submit does not open an email");

  const listed = new Set([...text.matchAll(/<a\b[^>]*\bhref\s*=\s*["']mailto:([^"'?\s<>]+)/gi)].map((m) => m[1].toLowerCase()));
  if (target && !listed.has(target[1].toLowerCase())) {
    wrong.push("the email the form opens is not the support address the page lists");
  }
  if (target && listed.size === 0) wrong.push("the page lists no support address");

  if (CARD_FIELD.test(text)) wrong.push("the page asks for a card number or card details");
  if (PAYMENT_SCRIPT.test(text)) wrong.push("the page loads a payment script");
  if (/<form\b[^>]*\baction\s*=\s*["']https?:/i.test(text)) wrong.push("the form posts to another site");
  if (!NO_CHARGE_WORDS.test(text)) wrong.push("the page does not say nothing is charged");

  if (wrong.length) {
    return verdict(surface, "FAIL",
      `${surface}: the live /consulting/ request form does not do what the step says: ${wrong.join("; ")}.`,
      "Restore the request form: it opens an email to the support address, and it takes no card. Do not auto-fix. Chris fixes reds.");
  }
  return verdict(surface, "PASS",
    `${surface}: the live /consulting/ form opens an email to the support address the page lists. It has no card field and no payment script, and it says nothing is charged. (The page calls this a consult request, not enrollment.)`);
}

// ── the reads ────────────────────────────────────────────────────────────────

/** The GET client the pulse hands the lane (daily-pulse.mjs passes fetchImpl). There is no fall back to the global
    one: a test or a script that did not hand a client gets a skip, not a call to the real site. */
function pickFetch(ctx) {
  if (typeof ctx.fetchImpl === "function") return ctx.fetchImpl;
  if (typeof ctx.fetch === "function") return ctx.fetch;
  return null;
}

function within(total) {
  const own = AbortSignal.timeout(READ_TIMEOUT_MS);
  return typeof AbortSignal.any === "function" && total ? AbortSignal.any([own, total]) : own;
}

async function get(fetchImpl, url, total) {
  const res = await fetchImpl(url, { method: "GET", headers: { accept: "*/*" }, signal: within(total) });
  if (!res || res.status !== 200) throw new Error(`${url} answered ${res ? res.status : "nothing"}`);
  return String(await res.text());
}

/** The same-site script addresses an HTML page loads, framework files left out. Pure. */
export function pageScripts(html, origin) {
  const out = [];
  for (const m of String(html || "").matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    let url;
    try { url = new URL(m[1], `${origin}/`); } catch { continue; }
    if (url.origin !== origin) continue;
    if (!url.pathname.startsWith("/climate/")) continue;
    if (/polyfills|webpack|main-app|framework/.test(url.pathname)) continue;
    if (!out.includes(url.href)) out.push(url.href);
  }
  return out.slice(0, MAX_SCRIPTS);
}

function skipped(surface, error) {
  const message = String(error?.message || error || "unknown read error").replace(/\s+/g, " ").slice(0, 160);
  return verdict(surface, "skip", `${surface} was not checked: ${message}.`);
}

async function readClimate(fetchImpl, origin, total, judge) {
  let api;
  let html;
  try {
    const [raw, page] = await Promise.all([
      get(fetchImpl, `${origin}/api/climate`, total),
      get(fetchImpl, `${origin}/climate/`, total),
    ]);
    html = page;
    try { api = JSON.parse(raw); } catch { throw new Error("the climate data door did not answer with JSON"); }
  } catch (error) {
    return skipped(CLIMATE_READING_SURFACE, error);
  }
  let scripts;
  try {
    const urls = pageScripts(html, origin);
    if (!urls.length) {
      return verdict(CLIMATE_READING_SURFACE, "FAIL",
        `${CLIMATE_READING_SURFACE}: the live /climate/ page loads no script of its own, so nothing on it can draw a map.`,
        "Open /climate/ and find why its scripts are gone. Do not auto-fix. Chris fixes reds.");
    }
    scripts = await Promise.all(urls.map((url) => get(fetchImpl, url, total)));
    // A page that fetches its outlines at run time names the file in its script; then the file counts.
    if (scripts.some((text) => /us-states-paths\.json/.test(text))) {
      scripts.push(await get(fetchImpl, `${origin}/climate/maps/us-states-paths.json`, total));
    }
  } catch (error) {
    return skipped(CLIMATE_READING_SURFACE, error);
  }
  const outlines = new Set();
  for (const text of scripts) for (const code of outlinesIn(text)) outlines.add(code);
  return judge({ api, outlines });
}

async function readConsulting(fetchImpl, origin, total, judge) {
  let html;
  try {
    html = await get(fetchImpl, `${origin}/consulting/`, total);
  } catch (error) {
    return skipped(CONSULTING_REQUEST_SURFACE, error);
  }
  return judge(html);
}

/**
 * Run both page reads. Returns Map(id -> { id, status, detail, suggestedFix }). Never throws.
 * ctx: { fetchImpl | fetch, baseUrl }. Without a GET client both rows are a skip with the reason.
 * `judges` is for the tests only: a judge that throws must end as a skip, never as a thrown lane.
 */
export async function runFinB22PageReads(ctx = {}, judges = { climate: judgeClimateReading, consulting: judgeConsultingRequest }) {
  const out = new Map();
  const fetchImpl = pickFetch(ctx || {});
  if (!fetchImpl) {
    for (const surface of [CLIMATE_READING_SURFACE, CONSULTING_REQUEST_SURFACE]) {
      const row = skipped(surface, "this run has no GET client");
      out.set(row.id, row);
    }
    return out;
  }
  let origin;
  try { origin = new URL(ctx.baseUrl || DEFAULT_BASE_URL).origin; } catch { origin = DEFAULT_BASE_URL; }
  const total = AbortSignal.timeout(RUN_TIMEOUT_MS);
  // A judge that throws on a page nobody planned for is a skip with the reason, never a thrown lane.
  const safe = (surface, pending) => pending.catch((error) => skipped(surface, error));
  const [climate, consulting] = await Promise.all([
    safe(CLIMATE_READING_SURFACE, readClimate(fetchImpl, origin, total, judges.climate)),
    safe(CONSULTING_REQUEST_SURFACE, readConsulting(fetchImpl, origin, total, judges.consulting)),
  ]);
  out.set(climate.id, climate);
  out.set(consulting.id, consulting);
  return out;
}
