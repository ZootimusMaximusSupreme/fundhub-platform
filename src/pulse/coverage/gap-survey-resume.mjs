// The come-back link. The 6 a.m. deep check for GET /api/public/survey-resume. Read only.
//
// WHAT A CUSTOMER FEELS WHEN IT BREAKS. A lead who stopped the /apply survey gets
// a welcome and three come-back messages (S-00, S-02), each with a link that should
// open the survey at the question they stopped on, with their name and answers
// already filled in. If the link stops working, the page quietly falls back to the
// top of the survey, and the person who came back has to start over.
//
// HOW IT JUDGES. It takes the newest real lead of the last 7 days, mints that
// person's link the way S-02 does (surveyResumeToken), and reads it the way the
// door does (readSurveyResume, imported from the handler, no web call). PASS only
// when the answer names that same person and its next question matches the
// answers on their file. No signing key on the server is a FAIL: every link then
// falls back to the plain /apply page (src/survey/resume-link.mjs).
//
// WHAT IT NEVER DOES. No write statement, no transaction control, no web call, no
// text, no email. The detail names the client code, never a name or an address.

import { surveyResumeToken, surveyResumeSecret } from "../../survey/resume-link.mjs";
import { nextSurveyKey, savedSurveyAnswers } from "../../survey/resume-state.mjs";
import { readSurveyResume } from "../../../api/public/survey-resume.mjs";
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

const FIX = "Open src/survey/resume-link.mjs and api/public/survey-resume.mjs. The link is signed with " +
  "UNSUBSCRIBE_TOKEN_SECRET (falling back to DOCUMENT_URL_SECRET); without one, every come-back link opens the " +
  "plain /apply page. Read only: this check sends nothing and changes nothing.";

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
    return [row("FAIL", "The server has no key to sign come-back links, so every one of them opens the survey at the top.")];
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
    const token = tokenOf({ clientId: lead.id, now, secret, env });
    answer = await readLink({ query: (sql, params) => read(sql, params) }, token, { now, secret, env });
  } catch (err) {
    return [row("FAIL", `The come-back link for ${who} could not be read: ${String(err?.message || err).slice(0, 120)}`)];
  }
  if (!answer || answer.ok !== true) {
    return [row("FAIL", `The come-back link for ${who} opens nothing: the door turned its own fresh link away.`)];
  }
  if (String(answer.contact?.email || "").toLowerCase() !== String(lead.email || "")) {
    return [row("FAIL", `The come-back link for ${who} opened a different person's survey.`)];
  }
  const want = nextSurveyKey(savedSurveyAnswers(lead.custom_fields));
  if ((answer.next_key ?? null) !== (want ?? null)) {
    return [row("FAIL", `The come-back link for ${who} opens at ${answer.next_key || "the end"}, but the file says ${want || "the end"}.`)];
  }
  return [row("PASS", `The come-back link for ${who} opens their own survey at ${want || "the end (every question answered)"}.`)];
}
