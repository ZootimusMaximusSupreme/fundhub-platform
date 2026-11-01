// GET/POST /api/public/climate-match — the lending-climate lead magnet at /climate/.
//
// COMPLIANCE REVIEW REQUIRED — public funding page. It returns a COUNT and real
// lender NAMES out of the CRM book and nothing else. No approval odds, no
// percentage, no dollar amount, no "you qualify". marketing/ads/climate-lead-magnet-offer-2026-09-18.md
// §7 bans all of those on this page and climate-match.test.mjs fails if one appears.
//
// GET  — how many active lenders the book holds. No body, no write, so this is
//        the door the 7:00 a.m. pulse pings.
// POST — runs the REAL staff matcher (src/lenders/match.mjs) over the same
//        active, non-demo rows /api/climate publishes, and returns the match
//        count, the lane counts, and the first few names as a teaser. When the
//        body carries a name and an email it also files the lead through the
//        EXISTING homepage-survey path (runSurveySubmit), so a climate lead
//        lands in the CRM exactly like a homepage lead and fires the same two
//        events. The states and the ad tags the homepage survey drops are then
//        merged onto clients.custom_fields.
//
// NO AUTH. Same class as survey-submit: a stranger on a public page.
// NO outbound SMS/email from this handler. NO credit pull. NO checkout — the $32
// unlock reuses POST /api/public/optimize, which mints SOFT_PULL on the existing
// keep catalog title. This handler never touches a Commas product.
//
// THE SELF-REPORTED SCORE DOES NOT MOVE THE COUNT, ON PURPOSE. No lender row in
// the book states a readable credit floor (match.mjs "THE CREDIT FILE"), and
// there is no agreed band -> number rule, so no credit profile is passed and the
// score gate does not run. The band is stored on the lead and the page says the
// count comes from the state and business answers. Turning "650-699" into a
// number here would be an invention that silently hides real lenders.

import { db } from "../../src/db.mjs";
import { pullCrmLenders } from "../../src/climate/connectors.mjs";
import { matchLenders } from "../../src/lenders/match.mjs";
import { runSurveySubmit } from "./survey-submit.mjs";
import { FICO_BANDS, LEGACY_FICO_BANDS } from "../../src/config/survey-qualification.mjs";
import { normalizePhone } from "../../src/messaging/providers/bland-voice.mjs";
import { safeError } from "../../src/http/health.mjs";

/** How many bank names a visitor sees before the gate. Brief §2, Model A. */
export const TEASER_LIMIT = 5;

/** The five ad tags. The homepage survey drops these; this page keeps them. */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

export const CLIMATE_SOURCE = "website:climate";

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return null; }
  }
  if (typeof req.rawBody === "string") {
    try { return JSON.parse(req.rawBody || "{}"); } catch { return null; }
  }
  return null;
}

function cleanStr(v, max = 200) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * Two letters, upper case, or null. A junk state is absent, never invented.
 *
 * NOT trimmed to two characters: "Arizona" cut to its first two letters is
 * "AR", a real and different state, so a visitor who typed a state name would
 * have been matched against Arkansas. The whole value must already be the code.
 */
function stateCode(v) {
  const s = cleanStr(v, 40).toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/**
 * yes -> true, no -> false, anything else -> null.
 * null means unknown, and matchLenders treats unknown as "blocks nobody".
 */
function triState(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = cleanStr(v, 12).toLowerCase();
  if (s === "yes" || s === "true") return true;
  if (s === "no" || s === "false") return false;
  return null;
}

/** Pure validation. Exported for unit tests. */
export function parseClimateMatchBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };
  const homeState = stateCode(body.home_state || body.homeState);
  if (!homeState) return { ok: false, error: "home_state_required" };
  const businessState = stateCode(body.business_state || body.businessState);
  const band = cleanStr(body.score_band || body.current_score, 20);
  const utm = {};
  for (const key of UTM_KEYS) {
    const v = cleanStr(body[key], 160);
    if (v) utm[key] = v;
  }
  const rawPhone = cleanStr(body.phone || body.mobile, 40);
  return {
    ok: true,
    homeState,
    businessState: businessState && businessState !== homeState ? businessState : null,
    hasBusiness: triState(body.has_business ?? body.hasBusiness),
    // A page built before 2026-10-31 may still send an older range; keep it.
    scoreBand: FICO_BANDS.includes(band) || LEGACY_FICO_BANDS.includes(band) ? band : null,
    name: cleanStr(body.name || body.full_name, 120),
    email: cleanStr(body.email, 160).toLowerCase(),
    phone: normalizePhone(rawPhone) || rawPhone,
    businessName: cleanStr(body.business_name || body.business, 160),
    smsConsent: !!body.sms_consent,
    utm
  };
}

/**
 * Public shape of one matched lender: the bank's NAME, its logo, and which lane
 * it is in. Nothing else.
 *
 * product_name is deliberately NOT here even though the matcher carries it.
 * Brief §2 Model A says the free teaser shows bank names; product names belong
 * to the gated list. And some of those names are the bank's own promotional
 * terms — "0% for 20 Months — No Business Checking Required" is a real
 * product_name in the live book — which on a public funding page reads as our
 * claim about credit terms rather than as a bank's product title. Nothing on
 * this page may say that (brief §7, marketing/ads/RULES.md Part 1).
 *
 * The staff money columns (typical_approval_range, average_starting_loc,
 * max_known_loc, insider_tips, stated_requirements) are absent for the same
 * reason and are never added here.
 */
function publicLender(m) {
  return {
    name: m.name,
    logo_path: m.logo_path ?? null,
    lane: m.lane
  };
}

/**
 * The count, the lanes and the teaser. Pure apart from the lender read, which
 * the caller injects, so this is testable with no database.
 */
export async function runClimateMatch(parsed, deps = {}) {
  const database = deps.db || db;
  const pull = deps.pullCrmLenders || pullCrmLenders;
  const pulled = await pull(database);
  const lenders = Array.isArray(pulled?.lenders) ? pulled.lenders : [];

  const result = matchLenders({
    lenders,
    homeState: parsed.homeState,
    businessState: parsed.businessState,
    businessOnFile: parsed.hasBusiness,
    includeInactive: false,
    includeDemo: false,
    // No pull on file and no agreed band -> number rule, so the score gate does
    // not run. summary.credit.available says so rather than implying a screen.
    credit: null
  });

  const s = result.summary;
  return {
    ok: true,
    book_size: lenders.length,
    count: s.match_count,
    lanes: {
      national: s.lane_counts.national,
      home: { state: s.home_state, count: s.lane_counts.home },
      business: { state: s.business_state, count: s.lane_counts.business }
    },
    teaser: result.matches.slice(0, TEASER_LIMIT).map(publicLender),
    teaser_limit: TEASER_LIMIT,
    held_for_no_business: s.held_for_no_business.message || null,
    // What the number is and is not. The page prints this sentence.
    basis: "state" + (parsed.hasBusiness === null ? "" : " and business"),
    score_used: false,
    stale: !!pulled?.stale
  };
}

/**
 * File the lead down the existing homepage-survey path, then keep the two
 * things that path throws away: the states and the ad tags. Never throws — a
 * lead that cannot be filed must still get its count.
 */
export async function recordClimateLead(parsed, deps = {}) {
  if (!parsed.name || !isEmail(parsed.email)) return { filed: false, clientId: null };
  const database = deps.db || db;
  const submit = deps.runSurveySubmit || runSurveySubmit;
  try {
    const answers = {};
    if (parsed.scoreBand) answers.cf_svy_self_reported_fico = parsed.scoreBand;
    if (parsed.hasBusiness !== null) answers.cf_svy_has_business = parsed.hasBusiness ? "Yes" : "No";
    const filed = await submit({
      ok: true,
      name: parsed.name,
      email: parsed.email,
      phone: parsed.phone,
      business: parsed.businessName,
      source: CLIMATE_SOURCE,
      sms_consent: parsed.smsConsent,
      answers
    }, deps);
    const clientId = filed?.clientId || null;
    if (clientId) {
      const patch = { home_state: parsed.homeState, ...parsed.utm };
      if (parsed.businessState) patch.business_state = parsed.businessState;
      await database.query(
        `UPDATE clients SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
        [clientId, JSON.stringify(patch)]
      );
    }
    return { filed: true, clientId };
  } catch {
    return { filed: false, clientId: null };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") return res.status(204).end();

  if (method === "GET") {
    try {
      const pulled = await pullCrmLenders(db);
      const lenders = Array.isArray(pulled?.lenders) ? pulled.lenders : [];
      return res.status(200).json({
        ok: true,
        book_size: lenders.length,
        teaser_limit: TEASER_LIMIT,
        score_bands: FICO_BANDS,
        stale: !!pulled?.stale
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: safeError(err) });
    }
  }

  if (method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const parsed = parseClimateMatchBody(readBody(req));
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

  try {
    const match = await runClimateMatch(parsed);
    const lead = await recordClimateLead(parsed);
    return res.status(200).json({ ...match, lead_filed: lead.filed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
