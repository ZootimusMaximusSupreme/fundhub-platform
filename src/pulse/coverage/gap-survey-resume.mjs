// The come-back link. The 6 a.m. deep check for GET /api/public/survey-resume. Read only.
//
// A v3 code is bound to the saved email. Old v1 text codes stay invalid.
//
// HOW IT JUDGES. It takes the newest real lead of the last 7 days, mints that
// person's v3 code with the server's real key, and reads it through the door.
// PASS when the saved answers and next question match that lead's record.
//
// WHAT IT NEVER DOES. No write statement, no transaction control, no web call, no
// text, no email. The detail names the client code, never a name or an address.

import { surveyResumeToken, surveyResumeSecret } from "../../survey/resume-link.mjs";
import { readSurveyResume } from "../../../api/public/survey-resume.mjs";
import { nextSurveyKey, savedSurveyAnswers } from "../../survey/resume-state.mjs";
import { testAddressSql } from "../beats/lib/handoff-truth.mjs";

export const CHECK_ID = "survey:resume-link-opens";
export const CHECK_IDS = Object.freeze([CHECK_ID]);
export const LOOKBACK_DAYS = 7;

/** $1 org, $2 window start. The newest real lead: their own opt-in, not demo, not a test address. */
export const NEWEST_LEAD_SQL = `
/* gap:survey-resume-lead */
SELECT c.id, c.client_code, lower(c.email) AS email, c.custom_fields
  FROM events e
  JOIN clients c ON c.org_id = e.org_id
                AND c.id = COALESCE(e.client_id, (
                      SELECT c0.id FROM clients c0
                       WHERE c0.org_id = e.org_id
                         AND lower(c0.email) = lower(btrim(COALESCE(e.payload->>'email', '')))
                       LIMIT 1))
 WHERE e.org_id = $1::uuid
   AND e.name = 'entry.captured'
   AND e.created_at >= $2::timestamptz
   AND COALESCE(e.is_demo, false) = false
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(c.email, '') <> ''
   AND NOT ${testAddressSql("lower(c.email)")}
 ORDER BY e.created_at DESC
 LIMIT 1`.trim();

const FIX = "Check the v3 email link and api/public/survey-resume.mjs. It must read this lead's saved " +
  "answers and next question. Keep old v1 text codes invalid and all SMS links plain /apply.";

function row(status, detail, suggestedFix = null) {
  return { id: CHECK_ID, status, detail, suggestedFix: status === "FAIL" ? suggestedFix || FIX : null };
}

export async function gapChecks(ctx = {}, deps = {}) {
  const read = typeof ctx.scope === "function"
    ? (sql, params) => ctx.scope((tx) => tx.query(sql, params))
    : ctx.db?.query?.bind(ctx.db);
  if (!read || !ctx.orgId) return [row("skip", "No database or no company in this run, so the come-back link was not read.")];
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const env = ctx.env || process.env;
  const secretOf = deps.surveyResumeSecret || surveyResumeSecret;
  const tokenOf = deps.surveyResumeToken || surveyResumeToken;
  const readLink = deps.readSurveyResume || readSurveyResume;

  let secret;
  try {
    secret = secretOf(env);
  } catch {
    secret = null;
  }
  if (!secret) {
    return [row("skip", "The server has no signing key, so there is no real resume code to try the door with.")];
  }

  let lead;
  try {
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    lead = (await read(NEWEST_LEAD_SQL, [ctx.orgId, since])).rows[0];
  } catch (err) {
    return [row("skip", `Could not read the newest lead: ${String(err?.message || err).slice(0, 120)}`)];
  }
  if (!lead) return [row("skip", `No real lead in the last ${LOOKBACK_DAYS} days to open a come-back link for.`)];

  const who = lead.client_code || "the newest lead";
  let answer;
  try {
    const token = tokenOf({ clientId: lead.id, email: lead.email, now, secret, env });
    answer = await readLink({ query: (sql, params) => read(sql, params) }, token, { now, secret, env });
  } catch (err) {
    return [row("FAIL", `The come-back link for ${who} could not be read: ${String(err?.message || err).slice(0, 120)}`)];
  }
  const expected = savedSurveyAnswers(lead.custom_fields);
  if (answer?.ok !== true ||
      String(answer.contact?.email || "").toLowerCase() !== lead.email ||
      JSON.stringify(answer.answers) !== JSON.stringify(expected) ||
      answer.next_key !== nextSurveyKey(expected)) {
    return [row("FAIL", `The v3 email link for ${who} did not open the saved survey at the next question.`)];
  }
  return [row("PASS", `The v3 email link for ${who} opens the saved survey at the next question.`)];
}
