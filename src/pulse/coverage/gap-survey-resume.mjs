// The come-back link. The 6 a.m. deep check for GET /api/public/survey-resume. Read only.
//
// CONTAINMENT (2026-10-31): THE DOOR MUST STAY SHUT. /apply accepts an existing
// lead's email with a new phone and writes that phone onto the record, so a signed
// resume code texted to "the lead" can reach a stranger. The code only proves it was
// minted, not who holds it, and the door used to hand back that lead's saved contact
// and answers. So the door is closed (api/public/survey-resume.mjs) and S-00/S-02
// send the plain /apply link. What a customer feels if this goes red: anyone holding
// a resume code can read that lead's saved answers.
//
// HOW IT JUDGES. It takes the newest real lead of the last 7 days, mints that
// person's code with the server's real key (surveyResumeToken), and reads it the way
// the door does (readSurveyResume, imported from the handler, no web call). PASS only
// when nothing comes back. Anything that comes back is a FAIL. No signing key is a
// skip: there is no real code to try the door with.
//
// WHAT IT NEVER DOES. No write statement, no transaction control, no web call, no
// text, no email. The detail names the client code, never a name or an address.

import { surveyResumeToken, surveyResumeSecret } from "../../survey/resume-link.mjs";
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

const FIX = "Open api/public/survey-resume.mjs. readSurveyResume must answer null for every code until a " +
  "resume link can prove the person opening it owns the record: /apply lets a new phone onto an existing " +
  "lead's email, so a code can reach a stranger. Read only: this check sends nothing and changes nothing.";

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
    const token = tokenOf({ clientId: lead.id, now, secret, env });
    answer = await readLink({ query: (sql, params) => read(sql, params) }, token, { now, secret, env });
  } catch (err) {
    return [row("FAIL", `The come-back link for ${who} could not be read: ${String(err?.message || err).slice(0, 120)}`)];
  }
  if (answer != null) {
    return [row("FAIL", `A resume code for ${who} opened their saved record. The door must stay shut until a link proves who is opening it.`)];
  }
  return [row("PASS", `A real resume code for ${who} opens nothing: no saved contact or answer leaves the door.`)];
}
