// GET/OPTIONS /api/public/survey-resume?r=<token> — where a lead stopped on /apply.
//
// Only a v3 code bound to the saved email opens this door. The old v1 codes were
// sent in texts, and /apply can put a stranger's phone on an existing email's
// record. Those old codes cannot verify under the new signing scheme. Texts
// still carry only the plain /apply link.
// The 400 for a missing token keeps the pulse ping working. /apply treats a 404
// as "start at the top" (marketing/landing-pages/apply-survey.html).
//
// The email link carries https://apply.fundhub.ai/apply?r=<token>. The page
// hands the token here and
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
// The person is not signed in. The v3 token delivered to their saved email is
// the credential (src/survey/resume-link.mjs). It is checked before a row read.
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
import { readSurveyResumeToken, surveyResumeTokenMatchesEmail } from "../../src/survey/resume-link.mjs";
import { nextSurveyKey, savedSurveyAnswers } from "../../src/survey/resume-state.mjs";
import { answerPreflight, applySloCors } from "../../src/slo/cors.mjs";

const METHODS = "GET, OPTIONS";

/**
 * readSurveyResume — a v3 email link opens the saved survey. Bad or old v1
 * codes return null without a database read. This is read only.
 */
export async function readSurveyResume(db, token, { now, secret, env } = {}) {
  const ids = readSurveyResumeToken(token, { now, secret, env });
  if (!ids) return null;
  const { rows } = await db.query(
    `SELECT first_name, last_name, email, phone, custom_fields
       FROM clients
      WHERE id = $1
      LIMIT 1`,
    [ids.clientId]
  );
  const row = rows[0];
  if (!row) return null;
  if (!surveyResumeTokenMatchesEmail(token, row.email, { now, secret, env })) return null;
  const answers = savedSurveyAnswers(row.custom_fields);
  return {
    ok: true,
    contact: {
      first_name: row.first_name || "",
      last_name: row.last_name || "",
      email: row.email || "",
      phone: row.phone || ""
    },
    answers,
    next_key: nextSurveyKey(answers)
  };
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
