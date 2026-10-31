// The come-back link truth for the hourly beat survey-resume. Read only.
//
// Two things a lead who stopped the /apply survey would feel:
//   survey:resume-door-answers  GET /api/public/survey-resume with no code answers 400
//                               {"error":"token_required"}: the door is deployed and its own
//                               handler answers (api/public/survey-resume.mjs). A 404 means the
//                               route fell out of the ROUTES map; a 500 means it crashed.
//   survey:resume-links-signed  CONTAINMENT (2026-10-31): the id is kept, the meaning flipped.
//                               NO welcome or come-back message (SMS/EMAIL-S00-WELCOME,
//                               SMS/EMAIL-S02-RESUME-*) written for a real person in the last 24
//                               hours carries a resume code (apply.fundhub.ai/apply?r=...).
//                               /apply lets a new phone onto an existing lead's email, so a code
//                               in a text can reach a stranger. The links are the plain /apply page.
// No welcome or come-back message in 24 hours is "nothing to judge", never green and never red.
//
// The 6 a.m. check survey:resume-link-opens (src/pulse/coverage/gap-survey-resume.mjs) goes
// deeper: it signs the newest real lead's code and proves the door hands back nothing.
//
// No code, link or page body is ever copied into a detail: paths, statuses and counts only.

import { testAddressSql } from "./handoff-truth.mjs";

export const CHECK_IDS = Object.freeze(["survey:resume-door-answers", "survey:resume-links-signed"]);
export const DOOR_PATH = "/api/public/survey-resume";
export const LOOKBACK_HOURS = 24;

/** $1 org, $2 now. Welcome and come-back messages for real people in the last day, and how many carry a resume code. */
export const COME_BACK_LINKS_SQL = `
/* beat:survey-resume-links */
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE m.rendered_body ~ 'apply\\.fundhub\\.ai/apply\\?r=')::int AS coded
  FROM messages m
  JOIN clients c ON c.org_id = m.org_id AND c.id = m.client_id
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND (m.template_key IN ('SMS-S00-WELCOME', 'EMAIL-S00-WELCOME')
        OR m.template_key LIKE 'SMS-S02-RESUME-%' OR m.template_key LIKE 'EMAIL-S02-RESUME-%')
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

async function linksCheck(io) {
  const id = CHECK_IDS[1];
  let row;
  try {
    row = (await io.read(COME_BACK_LINKS_SQL, [io.orgId, new Date(io.now.getTime()).toISOString()])).rows?.[0];
  } catch {
    return { id, status: "SKIP", detail: "the come-back messages could not be read" };
  }
  const total = Number(row?.total) || 0;
  const coded = Number(row?.coded) || 0;
  if (!total) {
    return { id, status: "SKIP", detail: `no welcome or come-back message was written in the last ${LOOKBACK_HOURS} hours, so there is nothing to judge` };
  }
  if (coded > 0) {
    return {
      id, status: "FAIL",
      detail: `${coded} of ${total} welcome and come-back messages in the last ${LOOKBACK_HOURS} hours carry a resume code, which can reach a phone nobody proved is the lead's`
    };
  }
  return { id, status: "PASS", detail: `none of ${total} welcome and come-back messages in the last ${LOOKBACK_HOURS} hours carries a resume code` };
}

/** io: { read, readWeb, orgId, now, baseUrl } from runLaneBeat. One result per CHECK_IDS entry. */
export async function runSurveyResumeChecks(io) {
  return [await doorCheck(io), await linksCheck(io)];
}
