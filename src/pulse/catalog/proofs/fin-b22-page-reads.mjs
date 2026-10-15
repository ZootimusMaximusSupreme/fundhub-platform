// Finish-853 batch 22, generation 2: live page reads for two journey rows (Flow lane).
//
// A journey step that names what a public page shows is judged by one read of the live page, the way a
// visitor's browser would get it: GET only, same site only, no login, nothing written, nothing sent.
//
//   journey:climate-lead-magnet-intended#2-reading-and-map
//       "Today's reading: national number and a map of 51 states from GET /api/climate"
//       Reads GET /api/climate (the data the page paints) and the scripts the live /climate/ page loads
//       (the page draws its map from a list of state outlines inside them). Red when
//         - the data door does not send 51 states, or a state has no number or no colour (a blank reading),
//           or the reading is not dated today;
//         - the page has fewer outlines than the data door has states (today it ships five);
//         - the outlines are placeholders, not a map: more than half are plain boxes, or too few differ in shape.
//
//   journey:fh-consulting-intended#5-request-enrollment
//       "the form opens an email to the support address; it takes no card"
//       Reads the live /consulting/ page. Green when its form opens an email (mailto) to the page's support
//       address AND that address is the one the owner set (CONSULTING_SUPPORT_ADDRESS, the address on all four
//       /consulting/ pages), and the page takes no card in any form: no card field (named by name, id,
//       placeholder, label or autocomplete), no payment script or frame, no link, form or button to a checkout or a
//       payment host, no "Pay" or "Buy" button, no form that posts away, and it says nothing is charged.
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

/**
 * The inbox the consulting page's form must open. The owner rewrote /consulting/ on 2026-10-05 and every page of it
 * (index, terms, privacy, refund) lists this address; the intended journey still names support@fundhub.ai, which is
 * the stale line (agents may not edit it). A typo or another inbox on the page is red here. A test holds this
 * constant to the four real pages, so changing the address is one deliberate edit, not an accident.
 */
export const CONSULTING_SUPPORT_ADDRESS = "support@fhconsulting.online";

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
const OUTLINE = /\\?["']([A-Z]{2})\\?["']\s*:\s*\\?["']([Mm][-\d.,\sLlHhVvCcSsQqTtAaZz]{6,})/g;

/** The state codes that have an outline in this script text. */
export function outlinesIn(text) {
  const found = new Set();
  for (const m of String(text || "").matchAll(OUTLINE)) if (VALID_CODE.has(m[1])) found.add(m[1]);
  return found;
}

/** Each state code with the path its outline is drawn with in this script text (Map code -> path). */
export function outlineShapes(text) {
  const found = new Map();
  for (const m of String(text || "").matchAll(OUTLINE)) if (VALID_CODE.has(m[1])) found.set(m[1], m[2].trim());
  return found;
}

/**
 * The corner points of a path made only of straight moves (M L H V Z, either case), or null when it has a
 * curve, an arc or anything else. Closing back to the first point does not add a corner.
 */
export function pathCorners(path) {
  const tokens = String(path || "").match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!tokens) return null;
  const pts = [];
  let x = 0;
  let y = 0;
  let cmd = null;
  const num = [];
  const flush = () => {
    if (cmd === null) return true;
    const rel = cmd === cmd.toLowerCase();
    const k = cmd.toUpperCase();
    if (k === "Z") { num.length = 0; return true; }
    if (k === "M" || k === "L") {
      if (num.length < 2 || num.length % 2) return false;
      for (let i = 0; i < num.length; i += 2) {
        x = rel ? x + num[i] : num[i];
        y = rel ? y + num[i + 1] : num[i + 1];
        pts.push([x, y]);
      }
    } else if (k === "H") {
      if (!num.length) return false;
      for (const n of num) { x = rel ? x + n : n; pts.push([x, y]); }
    } else if (k === "V") {
      if (!num.length) return false;
      for (const n of num) { y = rel ? y + n : n; pts.push([x, y]); }
    } else {
      return false;
    }
    num.length = 0;
    return true;
  };
  for (const t of tokens) {
    if (/[A-Za-z]/.test(t)) {
      if (!flush()) return null;
      cmd = t;
    } else {
      num.push(Number(t));
    }
  }
  if (!flush()) return null;
  const corners = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (corners.length > 1 && corners[0][0] === corners.at(-1)[0] && corners[0][1] === corners.at(-1)[1]) corners.pop();
  return corners;
}

/**
 * A placeholder, not a state's shape: a path of straight edges with three corners or fewer, or four corners that
 * make an upright box. A real map has a few boxy states (Wyoming, Colorado), never most of them.
 */
export function isPlainBox(path) {
  const corners = pathCorners(path);
  if (!corners) return false;
  if (corners.length <= 3) return true;
  if (corners.length !== 4) return false;
  const xs = new Set(corners.map((c) => c[0]));
  const ys = new Set(corners.map((c) => c[1]));
  return xs.size === 2 && ys.size === 2;
}

/** The shape of a path with its position taken out, so two states drawn alike at different places read as one. */
function shapeKey(path) {
  const corners = pathCorners(path);
  if (!corners || !corners.length) return String(path).replace(/\s+/g, " ");
  const [ox, oy] = corners[0];
  return corners.map(([cx, cy]) => `${Math.round((cx - ox) * 10) / 10},${Math.round((cy - oy) * 10) / 10}`).join(" ");
}

/** More than this many plain boxes among the 51 outlines and the "map" is a set of placeholders. */
export const MAX_PLAIN_BOXES = 25;
/** At least this many of the 51 outlines must differ in shape. */
export const MIN_DISTINCT_SHAPES = 45;
/** The reading is stamped when the door answers; older than this and the door is serving a canned reading. */
export const MAX_READING_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const CSS_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const PLAIN_LIST = (codes, max = 8) => {
  const list = [...codes].sort();
  return list.length > max ? `${list.slice(0, max).join(", ")} and ${list.length - max} more` : list.join(", ");
};

/**
 * Judge the live climate reading.
 *   api       the parsed JSON the data door sent (or null when it did not parse)
 *   outlines  a Map of state code -> the path the page's scripts draw it with. A bare Set of codes carries no
 *             shapes, so a map of placeholder boxes could not be told from a real one: it is red, never a pass.
 *   now       the clock (a test hands one)
 */
export function judgeClimateReading({ api, outlines, now = new Date() }) {
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

  // A state with no number or no colour paints as nothing: a blank reading that still has 51 names in it.
  const blank = api.states.filter((s) => {
    const score = s?.score;
    const numeric = score !== null && score !== undefined && score !== "" && Number.isFinite(Number(score));
    return !numeric || Number(score) < 0 || Number(score) > 100 || !CSS_COLOR.test(String(s?.color || ""));
  }).map((s) => String(s?.state || "?"));
  if (blank.length) {
    return verdict(surface, "FAIL",
      `${surface}: ${blank.length} of 51 states came from the data door with no score between 0 and 100 or no colour (${PLAIN_LIST(blank)}), so the map paints a blank reading for them.`,
      "Open GET /api/climate and find why those states have no score or colour. Do not auto-fix. Chris fixes reds.");
  }
  const rawNational = api.national ? api.national.score : null;
  const hasNational = rawNational !== null && rawNational !== undefined && rawNational !== "";
  if (hasNational && !Number.isFinite(Number(rawNational))) {
    return verdict(surface, "FAIL",
      `${surface}: the national number the data door sent (${JSON.stringify(String(rawNational).slice(0, 20))}) is not a number.`,
      "Open GET /api/climate and find why the national score is not a number. Do not auto-fix. Chris fixes reds.");
  }
  const stamp = Date.parse(String(api.as_of || ""));
  const clock = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(stamp) || Math.abs(clock - stamp) > MAX_READING_AGE_MS) {
    return verdict(surface, "FAIL",
      `${surface}: the reading is not dated today (as_of ${JSON.stringify(String(api.as_of ?? "none").slice(0, 30))}), so the door is serving an old reading as today's.`,
      "Open GET /api/climate and find why as_of is not the time of the request. Do not auto-fix. Chris fixes reds.");
  }

  const shapes = outlines instanceof Map ? outlines : null;
  const has = (code) => (shapes ? shapes.has(code) : Boolean(outlines && outlines.has && outlines.has(code)));
  const drawn = [...sent].filter(has);
  if (drawn.length !== sent.size) {
    const missing = [...sent].filter((code) => !has(code));
    const boxes = shapes ? drawn.filter((code) => isPlainBox(shapes.get(code))).length : 0;
    return verdict(surface, "FAIL",
      `${surface}: the live /climate/ page draws ${drawn.length} of ${sent.size} state outlines. There is no outline for ${missing.length} states (${PLAIN_LIST(missing)}), so those states cannot show on the map.${boxes && boxes === drawn.length ? ` The ${boxes} it has are plain boxes, not state shapes.` : ""}`,
      fix);
  }
  if (!shapes) {
    return verdict(surface, "FAIL",
      `${surface}: the shapes of the state outlines were not read, so a map cannot be told from a set of boxes.`,
      "Read the outline paths out of the page's scripts. Do not auto-fix. Chris fixes reds.");
  }
  const paths = [...sent].map((code) => shapes.get(code));
  const boxes = paths.filter(isPlainBox).length;
  const distinct = new Set(paths.map(shapeKey)).size;
  if (boxes > MAX_PLAIN_BOXES || distinct < MIN_DISTINCT_SHAPES) {
    return verdict(surface, "FAIL",
      `${surface}: the live /climate/ page has an outline for each of the 51 states, but they are placeholders, not a map: ${boxes} are plain boxes (a real map has a few) and ${distinct} of 51 differ in shape.`,
      "Draw the real state shapes in the climate page's map data. Do not auto-fix. Chris fixes reds.");
  }
  const score = hasNational ? Number(rawNational) : null;
  return verdict(surface, "PASS",
    `${surface}: the live /climate/ page draws all ${sent.size} state outlines the data door sends (${boxes} plain boxes, ${distinct} different shapes), every state has a score and a colour, and the data door sends ${score === null ? "no national number (the page shows a dash)" : `a national number of ${score}`}.`);
}

// ── consulting: the request form ─────────────────────────────────────────────

/** Words that name a card or a bank account on a field, a label, a placeholder or a hint. */
const CARD_WORDS = /card|cc-|\bcc[_ ]?(?:num|number|exp|csc|cvc|name)\b|cvc|cvv|cvn|\bcsc\b|expir|security[ -]?code|\bpan\b|routing number|account number/i;
/** A payment company, a checkout, or a place a payment is taken: in a link, a frame, a script, a form action or a string. */
const PAYMENT_WORDS = /stripe|paypal|braintree|squareup|\bsquare\.|authorize\.net|fanbasis|commas|klarna|affirm|afterpay|adyen|razorpay|paddle|gumroad|shopify|checkout|(?:^|[/.])pay(?:ment|ments)?(?:[/.?#]|$)|\/(?:buy|order|cart|purchase|billing|invoice)(?:[/?#]|$)/i;
/** A button or a link that asks for money. */
const PAY_BUTTON = /\b(?:pay|buy|purchase|check\s?out|order now|add to cart|subscribe|donate)\b/i;
const NO_CHARGE_WORDS = /nothing is charged|you are not charged|not a purchase|does not (?:take|charge) a card|this page does not charge/i;

const attrsOf = (tag) => {
  const out = {};
  for (const m of String(tag).matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  return out;
};
const textOf = (html) => String(html).replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();

/** Every field on the page that asks for a card or a bank account. Pure. */
export function cardFields(html) {
  const hits = [];
  for (const m of String(html || "").matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)) {
    const attrs = attrsOf(m[0]);
    const said = Object.entries(attrs)
      .filter(([key]) => !["value", "class", "type", "required", "style", "maxlength", "minlength", "pattern", "inputmode"].includes(key))
      .map(([, value]) => value)
      .join(" ");
    if (CARD_WORDS.test(said)) hits.push(m[0].slice(0, 80));
  }
  for (const m of String(html || "").matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)) {
    if (/card|cvc|cvv|expir|security code/i.test(textOf(m[1]))) hits.push(`label: ${textOf(m[1]).slice(0, 60)}`);
  }
  return hits;
}

/** Every address on the page that is a payment company, a checkout, or a pay/buy place. Pure. */
export function paymentLinks(html) {
  const text = String(html || "");
  const found = new Set();
  const consider = (value) => {
    const v = String(value || "").trim();
    if (!v || /^(?:#|mailto:|tel:|sms:)/i.test(v)) return;
    if (PAYMENT_WORDS.test(v)) found.add(v.slice(0, 100));
  };
  // addresses in markup: links, frames, scripts, form targets, button targets
  for (const m of text.matchAll(/<(?:a|iframe|frame|embed|object|script|link|form|button|input|img|source)\b[^>]*>/gi)) {
    const attrs = attrsOf(m[0]);
    for (const key of ["href", "src", "action", "formaction", "data", "data-href", "data-url", "data-src", "data-checkout", "data-action"]) {
      if (attrs[key] !== undefined) consider(attrs[key]);
    }
  }
  // addresses and paths written as strings, in any script on the page
  for (const m of text.matchAll(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`<>)]*/gi)) consider(m[0]);
  for (const m of text.matchAll(/["'`](\/[A-Za-z0-9_\-./?=&%#]{1,100})["'`]/g)) consider(m[1]);
  return [...found];
}

/** The text of every link and button on the page that asks for money. Pure. */
export function payButtons(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const label = textOf(m[2]);
    if (label && PAY_BUTTON.test(label)) out.push(label.slice(0, 60));
  }
  return out;
}

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
  if (target && target[1].toLowerCase() !== CONSULTING_SUPPORT_ADDRESS) {
    wrong.push(`the form opens an email to ${target[1].slice(0, 60)}, not to the support address ${CONSULTING_SUPPORT_ADDRESS}`);
  }
  if (listed.size && ![...listed].includes(CONSULTING_SUPPORT_ADDRESS)) {
    wrong.push(`the page does not list the support address ${CONSULTING_SUPPORT_ADDRESS}`);
  }

  const fields = cardFields(text);
  if (fields.length) wrong.push(`the page asks for a card number or card details (${fields[0]})`);
  const links = paymentLinks(text);
  if (links.length) wrong.push(`the page links, loads or posts to a payment or checkout address (${links[0]})`);
  const buttons = payButtons(text);
  if (buttons.length) wrong.push(`the page has a button or link that asks for money (${JSON.stringify(buttons[0])})`);
  if (/<form\b[^>]*\baction\s*=\s*["']https?:/i.test(text)) wrong.push("the form posts to another site");
  if (!NO_CHARGE_WORDS.test(text)) wrong.push("the page does not say nothing is charged");

  if (wrong.length) {
    return verdict(surface, "FAIL",
      `${surface}: the live /consulting/ request form does not do what the step says: ${wrong.join("; ")}.`,
      "Restore the request form: it opens an email to the support address, and it takes no card. Do not auto-fix. Chris fixes reds.");
  }
  return verdict(surface, "PASS",
    `${surface}: the live /consulting/ form opens an email to ${CONSULTING_SUPPORT_ADDRESS}, the support address the page lists. It has no card field, no payment script, link or button, and it says nothing is charged. (The page calls this a consult request, not enrollment.)`);
}

// ── the reads ────────────────────────────────────────────────────────────────

/** The GET client the pulse hands the lane (daily-pulse.mjs passes fetchImpl). There is no fall back to the global
    one: a test or a script that did not hand a client gets a skip, not a call to the real site. */
function pickFetch(ctx) {
  if (typeof ctx.fetchImpl === "function") return ctx.fetchImpl;
  if (typeof ctx.fetch === "function") return ctx.fetch;
  return null;
}

function within(total, readMs) {
  const own = AbortSignal.timeout(readMs);
  return typeof AbortSignal.any === "function" && total ? AbortSignal.any([own, total]) : own;
}

async function get(fetchImpl, url, total, readMs = READ_TIMEOUT_MS) {
  const res = await fetchImpl(url, { method: "GET", headers: { accept: "*/*" }, signal: within(total, readMs) });
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

async function readClimate(fetchImpl, origin, total, judge, readMs) {
  let api;
  let html;
  try {
    const [raw, page] = await Promise.all([
      get(fetchImpl, `${origin}/api/climate`, total, readMs),
      get(fetchImpl, `${origin}/climate/`, total, readMs),
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
    scripts = await Promise.all(urls.map((url) => get(fetchImpl, url, total, readMs)));
    // A page that fetches its outlines at run time names the file in its script; then the file counts.
    if (scripts.some((text) => /us-states-paths\.json/.test(text))) {
      scripts.push(await get(fetchImpl, `${origin}/climate/maps/us-states-paths.json`, total, readMs));
    }
  } catch (error) {
    return skipped(CLIMATE_READING_SURFACE, error);
  }
  const outlines = new Map();
  for (const text of scripts) for (const [code, path] of outlineShapes(text)) outlines.set(code, path);
  return judge({ api, outlines });
}

async function readConsulting(fetchImpl, origin, total, judge, readMs) {
  let html;
  try {
    html = await get(fetchImpl, `${origin}/consulting/`, total, readMs);
  } catch (error) {
    return skipped(CONSULTING_REQUEST_SURFACE, error);
  }
  return judge(html);
}

/**
 * Run both page reads. Returns Map(id -> { id, status, detail, suggestedFix }). Never throws.
 * ctx: { fetchImpl | fetch, baseUrl, readTimeoutMs, runTimeoutMs }. Without a GET client both rows are a skip with
 * the reason. The two time limits default to READ_TIMEOUT_MS and RUN_TIMEOUT_MS; only the tests change them.
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
  const readMs = Number(ctx.readTimeoutMs) > 0 ? Number(ctx.readTimeoutMs) : READ_TIMEOUT_MS;
  const total = AbortSignal.timeout(Number(ctx.runTimeoutMs) > 0 ? Number(ctx.runTimeoutMs) : RUN_TIMEOUT_MS);
  // A judge that throws on a page nobody planned for is a skip with the reason, never a thrown lane.
  const safe = (surface, pending) => pending.catch((error) => skipped(surface, error));
  const [climate, consulting] = await Promise.all([
    safe(CLIMATE_READING_SURFACE, readClimate(fetchImpl, origin, total, judges.climate, readMs)),
    safe(CONSULTING_REQUEST_SURFACE, readConsulting(fetchImpl, origin, total, judges.consulting, readMs)),
  ]);
  out.set(climate.id, climate);
  out.set(consulting.id, consulting);
  return out;
}
