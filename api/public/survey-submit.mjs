// POST /api/public/survey-submit — homepage (and later) multi-step survey capture.
// Emits entry.captured + survey.submitted (+ survey.completed when the last
// answer is in), then returns classifySurvey redirect.

import { db } from "../../src/db.mjs";
import { emit } from "../../src/events/bus.mjs";
import { ensureRegistered } from "../../src/register-all.mjs";
import { classifySurvey } from "../../src/config/survey-qualification.mjs";
import { SURVEY_REDIRECTS } from "../../src/config/homepage-survey-steps.mjs";
import {
  CF_SURVEY_QUESTIONS,
  answersByPayloadKey,
  surveyIsComplete,
} from "../../src/survey/cf-question-map.mjs";
import { safeError } from "../../src/http/health.mjs";
import { defaultOrgId } from "../../src/events/bus.mjs";
import { resolveClient } from "../../src/handlers/client-lifecycle.mjs";
import { normalizePhone } from "../../src/messaging/providers/bland-voice.mjs";

const KNOWN_PAYLOAD_KEYS = new Set(
  CF_SURVEY_QUESTIONS.filter((q) => q.type !== "contact").map((q) => q.payloadKey)
);

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      return null;
    }
  }
  if (typeof req.rawBody === "string") {
    try {
      return JSON.parse(req.rawBody || "{}");
    } catch {
      return null;
    }
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

/** Pure validation + answer filter. Exported for unit tests. */
export function parseSurveySubmitBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };

  const name = cleanStr(body.name || body.full_name, 120);
  const email = cleanStr(body.email, 160).toLowerCase();
  const rawPhone = cleanStr(body.phone || body.mobile, 40);
  const phone = normalizePhone(rawPhone) || rawPhone;
  const business = cleanStr(body.business || body.business_name, 160);
  const source = cleanStr(body.source, 80) || "website:home";
  const answersIn = body.answers && typeof body.answers === "object" ? body.answers : {};
  const byId =
    body.answers_by_id && typeof body.answers_by_id === "object" ? body.answers_by_id : null;

  if (!name || !isEmail(email)) {
    return { ok: false, error: "name_email_required" };
  }

  // Prefer title-keyed answers (CF attribute = None assumption in cf-question-map).
  // Also accept answers_by_id (stable ids) and legacy cf_svy_* until attributes land.
  const answers = {};
  if (byId) {
    Object.assign(answers, answersByPayloadKey(byId));
  }
  for (const [k, v] of Object.entries(answersIn)) {
    if (v == null || v === "") continue;
    if (KNOWN_PAYLOAD_KEYS.has(k) || k.startsWith("cf_svy_")) {
      answers[k] = v;
    }
  }

  return {
    ok: true,
    name,
    email,
    phone,
    business,
    source,
    sms_consent: !!body.sms_consent,
    answers,
  };
}

/** Find-or-create the client behind a survey submission. Never throws: a capture
 * that cannot resolve a client must still record its events rather than 500. */
async function resolveSurveyClient(database, parsed, deps = {}) {
  const resolve = deps.resolveClient || resolveClient;
  const orgOf = deps.defaultOrgId || defaultOrgId;
  try {
    const orgId = deps.orgId || (await orgOf(database));
    if (!orgId) return null;
    return await resolve(database, {
      orgId,
      payload: {
        email: parsed.email,
        name: parsed.name,
        phone: parsed.phone,
        source: parsed.source,
      },
    });
  } catch {
    return null;
  }
}

/** Emit + classify. `deps.emit` injectable for tests. */
export async function runSurveySubmit(parsed, deps = {}) {
  const emitFn = deps.emit || emit;
  const database = deps.db || db;
  const ensure = deps.ensureRegistered || ensureRegistered;

  // Classify first so redirect is ready even if capture work is slow.
  const qualification = classifySurvey(parsed.answers);
  const redirect = SURVEY_REDIRECTS[qualification] || SURVEY_REDIRECTS.MANUAL_REVIEW;

  ensure();

  // T14-11: the two events below used to land with client_id NULL, so nothing
  // downstream could tie them back to a person. S-02's "did they finish the
  // survey?" check reads events by client_id and could therefore never find the
  // survey.submitted row — every lead got nudged, including people who finished.
  // Resolve (or create) the client first and stamp both events with the id.
  const clientId = await resolveSurveyClient(database, parsed, deps);

  const idemBase = `website-survey:${parsed.email}:${Date.now()}`;
  const entryPayload = {
    email: parsed.email,
    name: parsed.name,
    phone: parsed.phone,
    business: parsed.business,
    source: parsed.source,
    sms_consent: parsed.sms_consent,
  };
  const entry = await emitFn(database, "entry.captured", entryPayload, {
    idempotencyKey: `${idemBase}:entry`,
    clientId,
  });
  const survey = await emitFn(
    database,
    "survey.submitted",
    {
      email: parsed.email,
      name: parsed.name,
      phone: parsed.phone,
      business: parsed.business,
      source: parsed.source,
      answers: parsed.answers,
    },
    { idempotencyKey: `${idemBase}:survey`, clientId }
  );
  // The whole survey arrives in one post here. Finished means the last answer is
  // in it (surveyIsComplete); that is what starts the no-booking chase. A partial
  // post (the climate page sends two answers) stays unfinished, so S-02 sends the
  // person back to finish it.
  const completed = surveyIsComplete(parsed.answers)
    ? await emitFn(
      database,
      "survey.completed",
      {
        email: parsed.email,
        name: parsed.name,
        phone: parsed.phone,
        business: parsed.business,
        source: parsed.source,
        answers: parsed.answers,
      },
      { idempotencyKey: `${idemBase}:completed`, clientId }
    )
    : null;

  return {
    ok: true,
    qualification,
    redirect,
    clientId,
    deduped: !!(entry.deduped || survey.deduped || completed?.deduped),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const parsed = parseSurveySubmitBody(readBody(req));
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  try {
    const result = await runSurveySubmit(parsed);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
