// GET/OPTIONS /api/public/survey-resume?r=<token> — where a lead stopped on /apply.
//
// CONTAINMENT (2026-10-31): CLOSED. Every token is the same 404 `{ ok: false }` and
// nothing is read. The signed token proves only that a link was minted for a client,
// not that the person holding it is that client: /apply accepts an existing lead's
// email with a new phone, writes the phone onto the record, and S-00/S-02 then texted
// the token to that phone, which opened the lead's saved contact and answers here.
// The senders now carry the plain /apply link (no token), and this door refuses the
// tokens already sent. It stays closed until a link can prove ownership of the record.
// The 400 for a missing token is kept so the pulse ping still counts the door as up.
// The /apply page treats the 404 as "start at the top" (marketing/landing-pages/apply-survey.html).
//
// What the door used to do, kept for the redesign:
//
// The text and the email that go to a lead who opted in and did not finish carry
// https://apply.fundhub.ai/apply?r=<token>. The page hands the token here and
// gets back who they are, what they already answered, and the question to show:
//
//   200 { ok: true,
//         contact:  { first_name, last_name, email, phone },        strings, "" when unknown
//         answers:  { cf_svy_<key>: "words" | ["words", ...] },    only what they answered
//         next_key: "cf_svy_<key>" | null }                        null = all answered
//   400 { ok: false, error: "token_required" }                     no r= at all
//   404 { ok: false }                                              bad, expired or unknown
//
// A request with NO token is a 400 and a bad token is a 404 on purpose: the morning
// pulse pings every routed door with a plain GET and counts 400 as up and 404 as
// down (src/pulse/registry.mjs isUp), so the bare ping must not look like an outage.
//
// NO AUTH, BY DESIGN. Same class as the unsubscribe and soft-pull links: the
// person is not signed in, so the signed token IS the credential
// (src/survey/resume-link.mjs). It is verified before anything is read.
//
// ONE ANSWER FOR EVERY KIND OF BAD LINK — forged, tampered, expired, truncated,
// or a client that no longer exists. The body is `{ ok: false }` and nothing else,
// so the door cannot be used to find out which ids exist.
//
// READ ONLY. It never writes, never emits, never sends. A mail scanner that
// follows the link changes nothing.
//
// ANSWERS ARE WORDS, never ClickFunnels option ids (src/survey/resume-state.mjs).
//
// readSurveyResume(db, token) is the whole read as a plain function, so the pulse
// can call it in-process with no HTTP. The handler below only adds the HTTP skin.
//
// Cross-site: the page is https://apply.fundhub.ai/apply and this door is on
// fundhub.ai, so OPTIONS is answered and Access-Control-Allow-Origin is echoed
// for allow-listed origins only (src/slo/cors.mjs). Never "*".

import { db as defaultDb } from "../../src/db.mjs";
import { safeError } from "../../src/http/health.mjs";
import { answerPreflight, applySloCors } from "../../src/slo/cors.mjs";

const METHODS = "GET, OPTIONS";

/**
 * readSurveyResume — CONTAINED (2026-10-31): null for every token, valid or not,
 * and the database is never asked. A token proves a link was minted, not that the
 * holder owns the record, so no saved contact or answer leaves through it. The
 * pulse check survey:resume-link-opens goes red if this ever answers again.
 */
export async function readSurveyResume(_db, _token, _opts = {}) {
  return null;
}

export default async function handler(req, res, deps = {}) {
  applySloCors(req, res, METHODS);
  res.setHeader("Cache-Control", "no-store");
  if (answerPreflight(req, res, METHODS)) return;
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET") {
    res.setHeader("allow", METHODS);
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const raw = req.query?.r;
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) return res.status(400).json({ ok: false, error: "token_required" });

  try {
    const found = await readSurveyResume(deps.db || defaultDb, token, {
      now: deps.now, secret: deps.secret, env: deps.env
    });
    if (!found) return res.status(404).json({ ok: false });
    return res.status(200).json(found);
  } catch (err) {
    console.error("survey-resume: read failed —", safeError(err));
    return res.status(500).json({ ok: false, error: "unavailable" });
  }
}
