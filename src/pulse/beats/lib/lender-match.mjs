/* Match lenders to a client's underwrite profile.
   Structural rules only — no invented approval criteria or lender names.

   Filters:
   1. active lenders only (unless includeInactive)
   2. eligible_states — the client has TWO states, home and business, and a
      lender is eligible when it covers EITHER (case-insensitive token match).
      Empty lender eligible_states = unknown → include (do not invent a
      restriction). No known client state = unknown → include.
   3. inquiry sensitivity — skip lenders whose bureaus_pulled intersect
      sensitive bureaus (open/recent inquiries on that bureau).
   4. the credit file — skip a lender whose own stated minimum score is above
      this file's score. See "THE CREDIT FILE" below for why this reads almost
      nothing today.
   5. bureau rotation — rank by how little the planned set already leans on
      each lender's expected bureau(s).

   6. no business on file, no business credit cards (owner rule 2026-09-06).

   Returns { matches, skipped, summary } — never fabricates lenders.

   ONE MATCHER, TWO CLOCKS (2026-10-20). This file used to be src/lenders/match.mjs. It moved here,
   unchanged, so the hourly beat lender-book runs the same matcher the client control panel and the
   round planner run. A beat may import only from src/pulse/beats/lib. src/lenders/match.mjs
   re-exports everything here, so every caller imports from there as before. Pure: no I/O. */

import { isBusinessLenderTable } from "./lender-tables.mjs";

/* Full names, because the summary strings below are read out loud on a call
   and printed on a screen. "EX" means nothing to a client. */
const BUREAU_FULL_NAME = Object.freeze({
  EX: "Experian",
  EQ: "Equifax",
  TU: "TransUnion",
  "D&B": "Dun & Bradstreet",
  "EX Biz": "Experian Business",
  "EQ Biz": "Equifax Business"
});

/** "Experian, Equifax and TransUnion" — an English list, not a slash list. */
function nameList(codes = []) {
  const names = (Array.isArray(codes) ? codes : [])
    .map((c) => BUREAU_FULL_NAME[c] || String(c))
    .filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

function plural(n, one, many) {
  return Number(n) === 1 ? one : many;
}

const BUREAU_ALIASES = Object.freeze({
  ex: "EX", experian: "EX",
  eq: "EQ", equifax: "EQ",
  tu: "TU", transunion: "TU", "trans union": "TU",
  "d&b": "D&B", dnb: "D&B", "dun & bradstreet": "D&B",
  "ex biz": "EX Biz", "eq biz": "EQ Biz"
});

/**
 * @param {string|null|undefined} raw
 * @returns {string[]} normalized bureau tokens
 */
export function parseBureaus(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  return String(raw)
    .split(/[/|,;+\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => BUREAU_ALIASES[t.toLowerCase()] || t.toUpperCase());
}

/* ─────────────────── TWO STATES, TWO LANES OF LENDERS ───────────────────
   Owner rule, 2026-09-04: eligibility runs off the client's HOME state AND
   their BUSINESS state, not one of them. "If they live in Arizona but they
   also have a business in Florida, that opens up two lanes of opportunity to
   national banks and then local banks that only do business in those two
   states."

   The defect this replaces: resolveMatchState() returned a single value, and
   returned it the moment it found a business state, so the home state was a
   fallback that never ran once a business existed. An Arizona client with a
   Florida business was matched as Florida only, and every Arizona-only local
   bank was dropped — silently, because a lender the state gate never reached
   is not in `skipped` either.

   Unknown stays unknown. A state we do not hold is not a block and never
   becomes one: an empty state set means every lender clears the state gate,
   exactly as an empty single state did before. */

/** Trimmed string, or null. Never "", never a fabricated value. */
function cleanState(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function pickState(obj, keys) {
  const o = obj && typeof obj === "object" ? obj : {};
  for (const k of keys) {
    const v = cleanState(o[k]);
    if (v) return v;
  }
  return null;
}

/**
 * The state the client's BUSINESS operates in.
 *
 * businesses.entity_data.state first — that is what the soft-pull intake
 * writes (api/soft-pull-approve.mjs → replaceSoftPullBusinesses) — then the
 * older `business_state` person field. The first business row that names a
 * state wins; which of several businesses counts is not a rule anybody has
 * written down, and picking one on a guess would be an invention.
 *
 * @param {object} [customFields]
 * @param {object[]} [businesses]
 * @returns {string|null}
 */
export function resolveBusinessState(customFields = {}, businesses = []) {
  for (const biz of Array.isArray(businesses) ? businesses : []) {
    const entity = biz && typeof biz.entity_data === "object" && biz.entity_data
      ? biz.entity_data
      : {};
    const fromBiz = pickState(entity, ["state", "business_state", "address_state"]);
    if (fromBiz) return fromBiz;
  }
  return pickState(customFields, ["business_state"]);
}

/**
 * The state the client LIVES in.
 *
 * Person custom fields first, then the personal address the soft-pull consent
 * form collects ("Enter your current street address, city, state, and ZIP"),
 * which is stored on pii_identity.addresses. Rows are passed in — this module
 * runs no queries and holds no database shape.
 *
 * `state` and `mailing_state` are generic keys with no business meaning, so
 * they read as home here. They used to sit in the middle of one blended chain,
 * which is exactly the ambiguity this split removes.
 *
 * @param {object} [customFields]
 * @param {object[]} [identityAddresses]  pii_identity.addresses entries
 * @returns {string|null}
 */
export function resolveHomeState(customFields = {}, identityAddresses = []) {
  const fromPerson = pickState(customFields, ["home_state", "state", "mailing_state"]);
  if (fromPerson) return fromPerson;
  for (const addr of Array.isArray(identityAddresses) ? identityAddresses : []) {
    const fromAddr = pickState(addr, ["address_state", "state", "addressState"]);
    if (fromAddr) return fromAddr;
  }
  return null;
}

/**
 * Both states, as a set. This is the shape the matcher wants.
 *
 * @param {object} [customFields]
 * @param {object[]} [businesses]
 * @param {object[]} [identityAddresses]
 * @returns {{ home: string|null, business: string|null, states: string[] }}
 *   `states` is deduped case-insensitively and is EMPTY when nothing is known.
 *   Empty means unknown, and unknown blocks nobody.
 */
export function resolveMatchStates(customFields = {}, businesses = [], identityAddresses = []) {
  const home = resolveHomeState(customFields, identityAddresses);
  const business = resolveBusinessState(customFields, businesses);
  const states = [];
  for (const s of [home, business]) {
    if (!s) continue;
    if (states.some((t) => t.toUpperCase() === s.toUpperCase())) continue;
    states.push(s);
  }
  return { home, business, states };
}

/**
 * Back-compat single state. Business first, then home — the old precedence, so
 * every existing caller keeps the answer it had. Prefer resolveMatchStates():
 * this one can only ever name one lane.
 *
 * @param {object} [customFields]
 * @param {object[]} [businesses]
 * @param {object[]} [identityAddresses]
 * @returns {string|null}
 */
export function resolveMatchState(customFields = {}, businesses = [], identityAddresses = []) {
  const { home, business } = resolveMatchStates(customFields, businesses, identityAddresses);
  return business || home || null;
}

/* ─────────────────────────── THE CREDIT FILE ───────────────────────────
   Funding finding 7, 2026-09-03: this matcher read state, bureau sensitivity
   and the active flag and nothing else, so a 588 repair file and a 780 funding
   file got the identical list and a lender who only takes 700+ matched both.

   MEASURED BEFORE BUILDING, against the load path
   (credentials/lenders-audit/lenders-audited.csv, 313 rows, the CSV import
   that fills this table):

     * there is no minimum-credit-score column on `lenders` at all — see
       db/migrations/138_lenders.sql. The nearest columns,
       minimum_time_in_business_years and minimum_revenue_threshold, are real
       and numeric but are 0/313 filled, and are business facts, not credit;
     * `stated_requirements` is filled on 75 of 313 rows and mentions checking
       accounts, seasoning and business age. Searching EVERY column of all 313
       rows for "fico", "credit score", "score" or an "NNN+" figure returns
       0 rows.

   So no lender in this table states a credit minimum, and this gate therefore
   excludes nobody today. That is the correct outcome and not a bug to route
   around: a guessed credit floor would silently hide real lenders from a real
   client. The pathway below is what the data drops into when it exists —
   either a numeric `minimum_credit_score` column (a migration nobody has
   written) or readable words in `stated_requirements`.

   Reading rule, both directions: a lender we cannot read is a lender we may
   not exclude. Unparseable requirement text keeps the lender and is counted
   as unreadable in the summary, never turned into a number. */

const FICO_MIN = 300;
const FICO_MAX = 850;

function fico(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= FICO_MIN && n <= FICO_MAX ? n : null;
}

/**
 * The credit file as the matcher sees it. Pure — the caller does the reading
 * (store.mjs owns the crs_results query) so this stays testable without a
 * database and cannot be handed a shape it did not ask for.
 *
 * `available` is true only when at least one in-range FICO score is present.
 * A tier or an estimate with no score cannot exclude a lender on score, and
 * saying "available" without one would let a caller believe otherwise.
 *
 * @param {object} [file]
 * @param {{EX?:number|null, EQ?:number|null, TU?:number|null}} [file.scores]
 * @param {number|null} [file.utilizationPct]  revolving card use, percent
 * @param {string|null} [file.tier]            stored outcome tier
 * @param {number|null} [file.fundingEstimate] stored total funding estimate
 * @param {string|Date|null} [file.pulledAt]
 * @returns {object} credit profile
 */
export function resolveCreditProfile({
  scores = {},
  utilizationPct = null,
  tier = null,
  fundingEstimate = null,
  pulledAt = null
} = {}) {
  const s = scores && typeof scores === "object" ? scores : {};
  const byBureau = {
    EX: fico(s.EX ?? s.ex ?? s.experian),
    EQ: fico(s.EQ ?? s.eq ?? s.equifax),
    TU: fico(s.TU ?? s.tu ?? s.transunion)
  };
  const present = Object.values(byBureau).filter((v) => v != null);
  const util = Number(utilizationPct);
  const est = Number(fundingEstimate);
  return {
    available: present.length > 0,
    scores: byBureau,
    /* The best bureau, not the middle or the worst. It is the only score that
       can be compared without over-excluding: a lender is refused only when
       even this client's strongest bureau is under the lender's own floor. */
    best_score: present.length ? Math.max(...present) : null,
    utilization_pct: Number.isFinite(util) ? util : null,
    tier: tier ? String(tier) : null,
    funding_estimate: Number.isFinite(est) ? est : null,
    pulled_at: pulledAt || null
  };
}

/* A three-digit figure only counts as a floor when the words around it say it
   is one AND say it is a credit score. Both halves are required: "2+ years
   business age" has a floor marker and no score, "700 average" has a score and
   no floor. Everything else reads as "no stated minimum". */
const MIN_MARKER = "(?:min(?:imum)?|at\\s+least|requires?|required|no\\s+less\\s+than|floor)";
// Word-bounded so "underscore" and the like are not read as a credit score.
const SCORE_WORD = "\\b(?:fico|credit\\s*score|scores?)\\b";
const GAP = "[^.;\\n]{0,30}?";
const MIN_SCORE_PATTERNS = [
  // "minimum credit score 700", "requires a FICO of 680"
  new RegExp(`\\b${MIN_MARKER}\\b${GAP}${SCORE_WORD}[^.;\\n]{0,15}?\\b([3-8]\\d{2})\\b`, "i"),
  // "minimum 700 FICO"
  new RegExp(`\\b${MIN_MARKER}\\b[^.;\\n]{0,15}?\\b([3-8]\\d{2})\\b[^.;\\n]{0,15}?${SCORE_WORD}`, "i"),
  // "FICO 700+", "credit score 680 or higher"
  new RegExp(`${SCORE_WORD}[^.;\\n]{0,20}?\\b([3-8]\\d{2})\\b\\s*(?:\\+|or\\s+(?:higher|above|better|more))`, "i"),
  // "700+ FICO"
  new RegExp(`\\b([3-8]\\d{2})\\s*\\+\\s*${SCORE_WORD}`, "i")
];

/* "No minimum credit score", "without a 700 FICO" — a negation in front of the
   phrase inverts it, so the number is not a floor. Cheaper and safer to drop
   the whole candidate than to try to read the sentence.

   The window stops at `.` and `;`, so a negation in an earlier clause cannot
   reach across and cancel a real floor in this one. Erring toward "negated"
   errs toward keeping the lender, which is the safe direction. */
const NEGATED = /\b(?:no|not|none|without|regardless\s+of)\b[^.;\n]{0,40}$/i;

/**
 * Does this text mention a credit score at all? Used to separate "states no
 * minimum" from "states one we could not read" in the summary, so a parser
 * that gets worse shows up as a number instead of as silently fewer skips.
 *
 * @param {string|null|undefined} raw
 * @returns {boolean}
 */
export function mentionsCreditScore(raw) {
  const text = String(raw || "");
  if (!text.trim()) return false;
  return new RegExp(`${SCORE_WORD}`, "i").test(text) && /\b[3-8]\d{2}\b/.test(text);
}

/**
 * The lender's own stated credit floor, or null.
 *
 * Numeric column first when one exists — `minimum_credit_score` is the drop-in
 * point for real data and is absent from the schema today. Otherwise a
 * conservative read of `stated_requirements`: when several candidates parse,
 * the LOWEST wins, because the lowest excludes the fewest people.
 *
 * @param {object} lender
 * @returns {{ min: number|null, source: string|null, unreadable: boolean }}
 */
export function lenderMinScore(lender = {}) {
  const column = fico(lender.minimum_credit_score);
  if (column != null) return { min: column, source: "column", unreadable: false };

  const raw = String(lender.stated_requirements || "");
  const found = [];
  for (const re of MIN_SCORE_PATTERNS) {
    const m = re.exec(raw);
    if (!m) continue;
    if (NEGATED.test(raw.slice(0, m.index + m[0].indexOf(m[1])))) continue;
    const n = fico(m[1]);
    if (n != null) found.push(n);
  }
  if (found.length) {
    return { min: Math.min(...found), source: "stated_requirements", unreadable: false };
  }
  return { min: null, source: null, unreadable: mentionsCreditScore(raw) };
}

/**
 * Which of this client's scores this lender would actually see. A lender that
 * names the bureau it pulls is judged on that bureau; one that names none — as
 * 310 of 313 rows do — is judged on the client's best score.
 *
 * @param {string[]} lenderBureaus  normalized codes from parseBureaus
 * @param {object} credit           a resolveCreditProfile result
 * @returns {number|null}
 */
export function scoreForLender(lenderBureaus = [], credit = null) {
  if (!credit || !credit.available) return null;
  const seen = (lenderBureaus || [])
    .map((b) => credit.scores?.[b])
    .filter((v) => v != null);
  if (seen.length) return Math.max(...seen);
  return credit.best_score;
}

/**
 * @param {string|null|undefined} eligibleStates
 * @param {string|null|undefined} clientState
 * @returns {boolean}
 */
export function stateEligible(eligibleStates, clientState) {
  const state = String(clientState || "").trim().toUpperCase();
  if (!state) return true; // unknown client state — do not invent a block
  const raw = String(eligibleStates || "").trim();
  if (!raw) return true; // unknown lender coverage — include
  if (/^all(\s+states)?$/i.test(raw) || raw === "*") return true;
  const tokens = raw
    .split(/[,;/|\n]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  if (!tokens.length) return true;
  return tokens.some((t) => t === state || t.includes(state) || state.includes(t));
}

/**
 * How wide this lender's own footprint is, by its own words. Structural — it
 * reads `eligible_states` and nothing else, and it invents no coverage.
 *
 *   "national" — the row says all states.
 *   "unknown"  — the row says nothing. stateEligible() already includes these
 *                (an unread footprint may not exclude anybody), so they sit in
 *                the same top group on the screen, but they are labelled
 *                separately so nobody reads a blank cell as a promise.
 *   "states"   — the row names a list.
 *
 * @param {string|null|undefined} eligibleStates
 * @returns {"national"|"unknown"|"states"}
 */
export function lenderFootprint(eligibleStates) {
  const raw = String(eligibleStates || "").trim();
  if (!raw) return "unknown";
  if (/^all(\s+states)?$/i.test(raw) || raw === "*") return "national";
  const tokens = raw.split(/[,;/|\n]+/).map((t) => t.trim()).filter(Boolean);
  return tokens.length ? "states" : "unknown";
}

/**
 * Eligible when the lender covers ANY of the client's known states. This is
 * the two-lane rule: home OR business, never home-then-stop.
 *
 * An empty state set is unknown, and unknown is not a block — the single
 * unknown state has always passed and it still does.
 *
 * @param {string|null|undefined} eligibleStates
 * @param {string[]|string|null} clientStates
 * @returns {boolean}
 */
export function eligibleForAnyState(eligibleStates, clientStates = []) {
  const states = (Array.isArray(clientStates) ? clientStates : [clientStates])
    .map((s) => (s == null ? "" : String(s).trim()))
    .filter(Boolean);
  if (!states.length) return stateEligible(eligibleStates, null);
  return states.some((s) => stateEligible(eligibleStates, s));
}

/**
 * Which lane a matched lender belongs in, in the owner's reading order:
 * national first, then the home-state locals, then the business-state locals.
 * A lender that covers both states is a home-lane lender and is NOT repeated.
 *
 * "unclassified" is only reachable when the lender names a state list and we
 * hold no state for the client at all — it passed the gate because unknown
 * does not block, and saying which lane it is in would be a guess.
 *
 * @param {string|null|undefined} eligibleStates
 * @param {{home?: string|null, business?: string|null}} [states]
 * @returns {"national"|"home"|"business"|"unclassified"}
 */
export function laneForLender(eligibleStates, { home = null, business = null } = {}) {
  const footprint = lenderFootprint(eligibleStates);
  if (footprint !== "states") return "national";
  if (home && stateEligible(eligibleStates, home)) return "home";
  if (business && stateEligible(eligibleStates, business)) return "business";
  return "unclassified";
}

const TERMINAL_CASE_STATUSES = new Set([
  "Completed", "Canceled", "Cancelled", "Cleared", "Closed"
]);

/**
 * Active inquiry_removal_case rows mark their bureau hot, unless an owner
 * override is present (gate_override_by + gate_override_at).
 * Pure — pass case rows in; no queries.
 *
 * @param {object[]} cases
 * @returns {Set<string>}
 */
export function bureausFromActiveCases(cases = []) {
  const out = new Set();
  for (const row of Array.isArray(cases) ? cases : []) {
    if (!row) continue;
    const status = String(row.case_status || row.status || "Queued");
    if (TERMINAL_CASE_STATUSES.has(status)) continue;
    if (/complete|cancel|clear|close/i.test(status)) continue;
    if (row.gate_override_by && row.gate_override_at) continue;
    const raw = row.selected_bureaus_raw || row.bureau || "";
    for (const c of parseBureaus(raw)) out.add(c);
  }
  return out;
}

/**
 * @param {object[]} inquiryLog  rows with { bureau, status?, created_at? }
 * @param {{ sensitiveStatuses?: string[], recentDays?: number, now?: Date,
 *           cases?: object[] }} [opts]
 * @returns {Set<string>} normalized bureau codes that should be avoided
 */
export function sensitiveBureaus(inquiryLog, opts = {}) {
  const statuses = new Set(
    (opts.sensitiveStatuses || ["open", "disputed", "new"]).map((s) => s.toLowerCase())
  );
  const recentDays = opts.recentDays ?? 30;
  const now = opts.now || new Date();
  const out = new Set();
  for (const row of Array.isArray(inquiryLog) ? inquiryLog : []) {
    const codes = parseBureaus(row?.bureau);
    if (!codes.length) continue;
    const st = String(row?.status || "open").toLowerCase();
    let hot = statuses.has(st);
    if (!hot && row?.created_at) {
      const t = new Date(row.created_at).getTime();
      if (Number.isFinite(t) && (now - t) / 86400000 <= recentDays) hot = true;
    }
    if (hot) for (const c of codes) out.add(c);
  }
  for (const c of bureausFromActiveCases(opts.cases || [])) out.add(c);
  return out;
}

function bureauOverlap(lenderBureaus, avoid) {
  return lenderBureaus.filter((b) => avoid.has(b));
}

/**
 * @param {object} opts
 * @param {object[]} opts.lenders
 * @param {string|null} [opts.clientState]  legacy single state. Still honoured:
 *   when no home/business state is given it is the whole state set.
 * @param {string|null} [opts.homeState]      where the client lives
 * @param {string|null} [opts.businessState]  where the client's business is
 * @param {string[]} [opts.clientStates]      explicit set, overrides the above
 * @param {object[]} [opts.inquiryLog]
 * @param {string|null} [opts.lenderTable]
 * @param {boolean} [opts.includeInactive]
 * @param {boolean} [opts.includeDemo]  Demo Mode. Default false = exclude.
 * @param {number} [opts.recentInquiryDays]
 * @param {object|null} [opts.credit]   resolveCreditProfile result, or null
 *   when no pull is on file. Null means the score gate does not run — it does
 *   NOT mean everybody passes it silently; `summary.credit.available` says so.
 * @param {boolean|null} [opts.businessOnFile]  Does this client have a company?
 *   `false` holds back every business product (owner rule 2026-09-06: no
 *   business on file, no business credit cards). `null`/undefined means we do
 *   not know, and an unknown never blocks — same rule as an unknown state.
 * @returns {{ matches: object[], skipped: object[], summary: object }}
 */
export function matchLenders({
  lenders = [],
  clientState = null,
  homeState = null,
  businessState = null,
  clientStates = null,
  inquiryLog = [],
  cases = [],
  lenderTable = null,
  includeInactive = false,
  includeDemo = false,
  recentInquiryDays = 30,
  credit = null,
  businessOnFile = null,
  now = new Date()
} = {}) {
  /* THE TWO LANES. `home` and `business` name the lanes; `states` is what the
     gate actually tests. A caller that only knows one state still works — it
     lands in `states` and nothing else changes for it. Deduped
     case-insensitively so "AZ" and "az" are one lane, not two. */
  const home = cleanState(homeState);
  const business = cleanState(businessState);
  const legacy = cleanState(clientState);
  const states = [];
  const addState = (s) => {
    const v = cleanState(s);
    if (!v) return;
    if (states.some((t) => t.toUpperCase() === v.toUpperCase())) return;
    states.push(v);
  };
  if (Array.isArray(clientStates)) {
    for (const s of clientStates) addState(s);
  } else {
    addState(home);
    addState(business);
    if (!states.length) addState(legacy);
  }
  // What the screen still calls "the client's state": business first, then
  // home, then whatever a legacy caller handed in. Unchanged precedence.
  const primaryState = business || home || legacy || null;

  const avoid = sensitiveBureaus(inquiryLog, { recentDays: recentInquiryDays, now, cases });
  const bureauUse = new Map(); // code → count among accepted so far (rotation)
  const matches = [];
  const skipped = [];
  let statedMinimums = 0;   // lenders whose own floor we could read
  let unreadable = 0;       // lenders that talk about a score we could not read
  let excludedOnScore = 0;

  /* NO BUSINESS ON FILE, NO BUSINESS CREDIT CARDS. Owner rule, 2026-09-06.
     Only an explicit `false` blocks. A caller that does not know whether the
     client has a company passes nothing, and nothing is blocked — the same
     way an unknown state has always been read. */
  const noBusiness = businessOnFile === false;
  let heldNoBusiness = 0;
  /* Held back because the client is protecting that bureau, counted per
     bureau so the screen can name the reason instead of quietly showing a
     shorter list. A lender that pulls two hot bureaus counts once in
     `heldSensitive` and once under each bureau. */
  let heldSensitive = 0;
  const heldByBureau = new Map();

  /* DEMO MODE, EXCLUDED BY DEFAULT.

     listLenders() already applies this gate in SQL, so the normal path never
     hands a demo row down here. This is the second layer: matchLenders is
     exported directly and any caller can pass it an array it assembled
     itself, and a real client on a real call must never see a sample lender
     no matter which caller built the list.

     Dropped rows do NOT go into `skipped`. `skipped` is shown on the round
     planner, and a row listed there by name is still a demo lender disclosed
     to a real client. With Demo Mode off they are absent, not refused. */
  const list = (Array.isArray(lenders) ? lenders : [])
    .filter((L) => includeDemo || !L?.is_demo);
  for (const L of list) {
    if (!L) continue;
    if (lenderTable && L.lender_table !== lenderTable) {
      skipped.push({ id: L.id, name: L.name, reason: "wrong_table" });
      continue;
    }
    if (!includeInactive && L.active === false) {
      skipped.push({ id: L.id, name: L.name, reason: "inactive" });
      continue;
    }
    if (noBusiness && isBusinessLenderTable(L.lender_table)) {
      heldNoBusiness++;
      skipped.push({
        id: L.id, name: L.name, reason: "no_business_on_file",
        lender_table: L.lender_table
      });
      continue;
    }
    if (!eligibleForAnyState(L.eligible_states, states)) {
      skipped.push({
        id: L.id, name: L.name, reason: "state_ineligible",
        client_states: [...states]
      });
      continue;
    }
    const bureaus = parseBureaus(L.bureaus_pulled);
    const hit = bureauOverlap(bureaus, avoid);
    if (hit.length) {
      heldSensitive++;
      for (const b of hit) heldByBureau.set(b, (heldByBureau.get(b) || 0) + 1);
      skipped.push({
        id: L.id, name: L.name, reason: "inquiry_sensitive",
        bureaus: hit,
        bureau_names: hit.map((b) => BUREAU_FULL_NAME[b] || b)
      });
      continue;
    }

    /* THE CREDIT FILE. Reached only after the structural gates, so a lender
       refused for its state or a hot bureau is never also reported as a credit
       refusal. Order matters on the screen: `skipped` is read out loud. */
    const requirement = lenderMinScore(L);
    if (requirement.min != null) statedMinimums++;
    if (requirement.unreadable) unreadable++;
    const fileScore = scoreForLender(bureaus, credit);
    if (requirement.min != null && fileScore != null && fileScore < requirement.min) {
      excludedOnScore++;
      skipped.push({
        id: L.id, name: L.name, reason: "score_below_minimum",
        minimum_score: requirement.min,
        minimum_source: requirement.source,
        file_score: fileScore
      });
      continue;
    }

    const rotationCost = bureaus.reduce((s, b) => s + (bureauUse.get(b) || 0), 0);
    const tier = L.priority_tier == null ? 99 : Number(L.priority_tier);
    matches.push({
      id: L.id,
      name: L.name,
      /* THE PRODUCT. One bank can offer several cards — American Express
         alone has four personal cards in the book — and without this the
         screen draws four rows that all read "American Express". Carried
         through as it is stored; a bank row with no product named keeps a
         null, and null means the row is the bank itself. */
      product_name: L.product_name ?? null,
      lender_table: L.lender_table,
      /* THE LOGO. 244 logo files ship in public/assets/lenders/ and the
         column is filled on import, but the matcher used to drop it here, so
         no screen built off a match result could ever draw one. Carried
         through untouched — null stays null, and a null is a missing logo,
         never a placeholder invented at this layer. */
      logo_path: L.logo_path ?? null,
      bureaus_pulled: L.bureaus_pulled,
      bureaus,
      eligible_states: L.eligible_states,
      footprint: lenderFootprint(L.eligible_states),
      lane: laneForLender(L.eligible_states, { home, business }),
      covers_states: states.filter((s) => stateEligible(L.eligible_states, s)),
      priority_tier: L.priority_tier,
      application_url: L.application_url,
      typical_approval_range: L.typical_approval_range,
      average_starting_loc: L.average_starting_loc,
      max_known_loc: L.max_known_loc,
      insider_tips: L.insider_tips,
      stated_requirements: L.stated_requirements,
      stated_minimum_score: requirement.min,
      is_demo: !!L.is_demo,
      rotation_cost: rotationCost,
      sort_tier: tier
    });
  }

  matches.sort((a, b) => {
    if (a.sort_tier !== b.sort_tier) return a.sort_tier - b.sort_tier;
    if (a.rotation_cost !== b.rotation_cost) return a.rotation_cost - b.rotation_cost;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  // Recompute rotation in final order so the board can show a spread plan.
  bureauUse.clear();
  for (const m of matches) {
    m.rotation_cost = m.bureaus.reduce((s, b) => s + (bureauUse.get(b) || 0), 0);
    for (const b of m.bureaus) bureauUse.set(b, (bureauUse.get(b) || 0) + 1);
  }
  matches.sort((a, b) => {
    if (a.sort_tier !== b.sort_tier) return a.sort_tier - b.sort_tier;
    if (a.rotation_cost !== b.rotation_cost) return a.rotation_cost - b.rotation_cost;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  /* THE READING ORDER the owner asked for: national banks, then the local
     banks in the state he lives in, then the local banks in the state his
     business is in. Every match appears exactly once — a lender covering both
     states is a home-lane lender and is not repeated in the business lane.
     `matches` is untouched and still the flat, tier-ranked list. */
  const lanes = {
    national: matches.filter((m) => m.lane === "national"),
    home: { state: home, lenders: matches.filter((m) => m.lane === "home") },
    business: { state: business, lenders: matches.filter((m) => m.lane === "business") },
    /* Named a state list, cleared the gate, but we hold no home or business
       state to attribute it to. Empty whenever the caller passes both. */
    unclassified: matches.filter((m) => m.lane === "unclassified")
  };

  /* WHY THE LIST IS SHORTER THAN IT WAS. Two gates take lenders away for a
     reason the client can be told out loud, and both used to be invisible:
     the count simply came out lower and nobody could say why. These two
     blocks are the sentence the screen prints. */
  const protectedBureaus = [...avoid].filter((b) => heldByBureau.has(b));
  const heldForBureau = {
    count: heldSensitive,
    bureaus: protectedBureaus,
    bureau_names: protectedBureaus.map((b) => BUREAU_FULL_NAME[b] || b),
    by_bureau: Object.fromEntries([...heldByBureau].map(([b, n]) => [b, n])),
    message: heldSensitive
      ? `${heldSensitive} ${plural(heldSensitive, "lender is", "lenders are")} held back `
        + `because you are protecting ${nameList(protectedBureaus)}.`
      : null
  };
  const heldForBusiness = {
    /* null = we were not told whether this client has a company, so nothing
       was held back on that basis and the screen must not claim otherwise. */
    business_on_file: businessOnFile === true ? true : (noBusiness ? false : null),
    count: heldNoBusiness,
    message: heldNoBusiness
      ? `${heldNoBusiness} business ${plural(heldNoBusiness, "card is", "cards are")} held back `
        + "because there is no business on file. Business cards are issued to a company."
      : null
  };

  return {
    matches,
    skipped,
    lanes,
    summary: {
      lender_count: list.length,
      match_count: matches.length,
      skipped_count: skipped.length,
      sensitive_bureaus: [...avoid],
      sensitive_bureau_names: [...avoid].map((b) => BUREAU_FULL_NAME[b] || b),
      held_for_bureau_protection: heldForBureau,
      held_for_no_business: heldForBusiness,
      client_state: primaryState,
      client_states: [...states],
      home_state: home,
      business_state: business,
      lane_counts: {
        national: lanes.national.length,
        home: lanes.home.lenders.length,
        business: lanes.business.lenders.length,
        unclassified: lanes.unclassified.length
      },
      /* What the credit file actually did to this count. The three counters
         are the honest answer to "does this number mean anything about this
         client" — with today's data lenders_with_stated_minimum is 0, so the
         answer is no, and the closer screen has to be able to say that rather
         than imply a screen that did not happen. */
      credit: {
        available: !!(credit && credit.available),
        scores: credit && credit.available ? credit.scores : null,
        best_score: credit && credit.available ? credit.best_score : null,
        utilization_pct: credit ? credit.utilization_pct : null,
        tier: credit ? credit.tier : null,
        funding_estimate: credit ? credit.funding_estimate : null,
        pulled_at: credit ? credit.pulled_at : null,
        lenders_with_stated_minimum: statedMinimums,
        lenders_with_unreadable_requirement: unreadable,
        lenders_excluded_on_score: excludedOnScore
      }
    }
  };
}

/** Convenience for deal-funding / closer dashboard. */
export function lenderMatchCount(opts) {
  return matchLenders(opts).summary.match_count;
}
