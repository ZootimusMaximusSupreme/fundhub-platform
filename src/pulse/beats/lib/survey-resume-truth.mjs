// The come-back link truth for the hourly beat survey-resume. Read only.
//
// Three things a lead who stopped the /apply survey would feel:
//   survey:resume-door-answers     GET /api/public/survey-resume with no code answers 400
//                                  {"error":"token_required"}: the door is deployed and its own
//                                  handler answers (api/public/survey-resume.mjs). A 404 means the
//                                  route fell out of the ROUTES map; a 500 means it crashed.
//   survey:resume-links-signed     every come-back EMAIL (EMAIL-S02-RESUME-*) written for a real
//                                  person in the last 24 hours carries a signed link
//                                  (apply.fundhub.ai/apply?r=...). With no signing key,
//                                  surveyResumeUrl falls back to the plain /apply page and the
//                                  person starts over (src/survey/resume-link.mjs).
//   survey:resume-no-link-in-texts NO text written in the last 24 hours carries a signed link. The
//                                  link opens the person's saved answers, and the phone on a record
//                                  can belong to someone else (review 2026-10-31), so a link in a
//                                  text is a leak, not a lost feature. Red on the first one.
// No come-back email, or no text, in 24 hours is "nothing to judge", never green and never red.
//
// The 6 a.m. check survey:resume-link-opens (src/pulse/coverage/gap-survey-resume.mjs) goes
// deeper: it signs the newest real lead's link and opens it the way the door does.
//
// No code, link or page body is ever copied into a detail: paths, statuses and counts only.

import { testAddressSql } from "./handoff-truth.mjs";

export const CHECK_IDS = Object.freeze([
  "survey:resume-door-answers",
  "survey:resume-links-signed",
  "survey:resume-no-link-in-texts"
]);
export const DOOR_PATH = "/api/public/survey-resume";
export const LOOKBACK_HOURS = 24;

/** $1 org, $2 now. Last day, real people: come-back emails and how many carry a signed link,
    texts and how many carry one. */
export const COME_BACK_LINKS_SQL = `
/* beat:survey-resume-links */
SELECT count(*) FILTER (WHERE m.template_key LIKE 'EMAIL-S02-RESUME-%')::int AS total,
       count(*) FILTER (WHERE m.template_key LIKE 'EMAIL-S02-RESUME-%'
                          AND m.rendered_body ~ 'apply\\.fundhub\\.ai/apply\\?r=[A-Za-z0-9_-]{20,}')::int AS signed,
       count(*) FILTER (WHERE m.channel = 'sms')::int AS texts,
       count(*) FILTER (WHERE m.channel = 'sms'
                          AND m.rendered_body ~ 'apply\\.fundhub\\.ai/apply\\?r=')::int AS texts_with_link
  FROM messages m
  JOIN clients c ON c.org_id = m.org_id AND c.id = m.client_id
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND (m.template_key LIKE 'EMAIL-S02-RESUME-%' OR m.channel = 'sms')
   AND m.created_at > $2::timestamptz - interval '${LOOKBACK_HOURS} hours'
   AND m.created_at <= $2::timestamptz
   AND COALESCE(m.is_demo, false) = false
   AND COALESCE(c.is_demo, false) = false
   AND NOT ${testAddressSql("lower(c.email)")}`.trim();

async function doorCheck(io) {
  const id = CHECK_IDS[0];
  if (!/^https:\/\/[^/]+$/.test(String(io.baseUrl || ""))) {
    return { id, status: "FAIL", detail: "the site address (URL) is not set for this run, so the door was not asked" };
  }
  let res;
  try {
    res = await io.readWeb("GET", `${io.baseUrl}${DOOR_PATH}`);
  } catch {
    res = null;
  }
  const status = Number(res?.status || 0);
  if (!status) return { id, status: "FAIL", detail: `GET ${DOOR_PATH} got no answer` };
  if (status === 400 && /"token_required"/.test(String(res.text || ""))) {
    return { id, status: "PASS", detail: `GET ${DOOR_PATH} answers 400 token_required` };
  }
  return { id, status: "FAIL", detail: `GET ${DOOR_PATH} answered ${status}, wanted 400 token_required` };
}

function linksCheck(row) {
  const id = CHECK_IDS[1];
  if (!row) return { id, status: "SKIP", detail: "the come-back messages could not be read" };
  const total = Number(row.total) || 0;
  const signed = Number(row.signed) || 0;
  if (!total) {
    return { id, status: "SKIP", detail: `no come-back email was written in the last ${LOOKBACK_HOURS} hours, so there is nothing to judge` };
  }
  if (signed < total) {
    return {
      id, status: "FAIL",
      detail: `${total - signed} of ${total} come-back emails in the last ${LOOKBACK_HOURS} hours have no signed link, so they open the survey at the top`
    };
  }
  return { id, status: "PASS", detail: `all ${total} come-back emails in the last ${LOOKBACK_HOURS} hours carry a signed link` };
}

function textsCheck(row) {
  const id = CHECK_IDS[2];
  if (!row) return { id, status: "SKIP", detail: "the texts could not be read" };
  const texts = Number(row.texts) || 0;
  const leaked = Number(row.texts_with_link) || 0;
  if (leaked > 0) {
    return {
      id, status: "FAIL",
      detail: `${leaked} of ${texts} texts in the last ${LOOKBACK_HOURS} hours carry a come-back link, which opens the person's saved answers to whoever holds that phone`
    };
  }
  if (!texts) return { id, status: "SKIP", detail: `no text was written in the last ${LOOKBACK_HOURS} hours, so there is nothing to judge` };
  return { id, status: "PASS", detail: `none of the ${texts} texts in the last ${LOOKBACK_HOURS} hours carries a come-back link` };
}

/** io: { read, readWeb, orgId, now, baseUrl } from runLaneBeat. One result per CHECK_IDS entry. */
export async function runSurveyResumeChecks(io) {
  let row = null;
  try {
    row = (await io.read(COME_BACK_LINKS_SQL, [io.orgId, new Date(io.now.getTime()).toISOString()])).rows?.[0] || null;
  } catch {
    row = null;
  }
  return [await doorCheck(io), linksCheck(row), textsCheck(row)];
}
