// Survey qualification — the Stage 2 gate (05/30 source of truth, lines 36-44).
//
// Two gates, both must pass to book a funding call:
//   1. cf_svy_self_reported_fico is "700-759" or "760-850" (owner-set 2026-10-31;
//      answers saved before then said "700-749" or "750+", and still pass)
//   2. cf_svy_has_negatives = "No"
// Fail either -> the application-stage credit repair downsell, which under 05/30 is
// OUTSOURCED and automated (dispute-letter referral), NOT an in-house repair track
// (lines 40-41, and the decommission note at 1233-1235).
//
// THE ABSENT CASE IS NOT A FAILURE. Doc line 206: the cf_svy_has_negatives field key is
// "pending from DirectROAS. The Stage 2 gate is not enforceable until it exists." So a
// missing answer resolves to MANUAL_REVIEW — never PASS, never DOWNSELL. Failing open
// sends unqualified people to a funding call; failing closed sends qualified people to
// the downsell. Both are worse than a human looking. The day DirectROAS ships the field,
// real values start arriving and the gate simply begins working — no code change.
//
// Kept in one config module (not inlined in a workflow) so the bands can move without
// touching workflow code, same as lead-temperature.mjs and product-path.mjs.

import { surveyFicoBand } from "../survey/cf-question-map.mjs";

export const PASS = "PASS";
export const DOWNSELL = "DOWNSELL";
export const MANUAL_REVIEW = "MANUAL_REVIEW";

// The score answers on the survey, low to high (owner-set 2026-10-30, final:
// "500 to 620. 620 to 699. 700 to 760. 760 to 850."). A score of exactly 620 is
// 620-699, so the first answer ends at 619. Both lane lines, 620 and 700, sit on
// an edge, so the survey alone places every person.
export const FICO_BANDS = ["500-619", "620-699", "700-759", "760-850", "Not sure"];

// Only these two answers clear gate 1: 700 and up is qualified credit.
export const PASSING_FICO_BANDS = ["700-759", "760-850"];

// The answers the survey offered before 2026-10-31. People who answered then
// still have these saved, and they read the same as they always did.
export const LEGACY_FICO_BANDS = ["500-579", "580-649", "650-699", "700-749", "750+"];
export const LEGACY_PASSING_FICO_BANDS = ["700-749", "750+"];

// Normalize the en-dash the doc's own field modal uses (line 5146 prints "500–579")
// against the hyphen the gate spec uses (line 38). Same band, two glyphs.
function normalizeBand(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/[‒-―]/g, "-");
  return s === "" ? null : s;
}

// "Not sure" is a real, selectable answer — it is not an absent answer. It fails gate 1
// (it is not one of the two passing bands) rather than routing to manual review.
export function ficoGatePasses(fico) {
  const band = normalizeBand(fico);
  if (band === null) return null; // absent -> caller decides (manual review)
  return PASSING_FICO_BANDS.includes(band) || LEGACY_PASSING_FICO_BANDS.includes(band);
}

/* creditTierFor — the owner's two buckets (2026-10-29) for one person:
   "qualified" (a 700-and-up answer), "unqualified" (any other answer, Not sure
   too), or null (no readable answer yet). A setter's fix on the call
   (setter_survey_edits) wins over what the person typed. This is the one rule
   behind the two calendars, the booking links in texts and emails, and the
   credit_tier saved on the person. */
export function creditTierFor(fields = {}) {
  const cf = fields && typeof fields === "object" ? fields : {};
  const edits = cf.setter_survey_edits && typeof cf.setter_survey_edits === "object" ? cf.setter_survey_edits : {};
  const band = surveyFicoBand({ cf_svy_self_reported_fico_label: normalizeBand(edits.cf_svy_self_reported_fico) })
    || surveyFicoBand({ ...cf,
      cf_svy_self_reported_fico_label: normalizeBand(cf.cf_svy_self_reported_fico_label),
      cf_svy_self_reported_fico: normalizeBand(cf.cf_svy_self_reported_fico) })
    || surveyFicoBand({ cf_svy_self_reported_fico: normalizeBand(cf.svy_self_reported_fico) });
  const pass = ficoGatePasses(band);
  if (pass === null) return null;
  return pass ? "qualified" : "unqualified";
}

// Gate 2. Yes/No per doc line 147. Anything else present-but-unrecognized is treated as
// absent rather than guessed at.
export function negativesGatePasses(hasNegatives) {
  if (hasNegatives == null) return null;
  const s = String(hasNegatives).trim().toLowerCase();
  if (s === "" ) return null;
  if (s === "no" || s === "false") return true;
  if (s === "yes" || s === "true") return false;
  return null; // unrecognized value — do not guess, send to manual review
}

// classifySurvey — pure, no I/O. Returns PASS | DOWNSELL | MANUAL_REVIEW.
//
// Ordering matters. A definite FAIL on either gate is a DOWNSELL even if the other gate
// is unknown: the doc says "FAIL either gate goes to the ... downsell" (line 40), and a
// known failure is not made uncertain by an unrelated missing field. Only when nothing
// has definitively failed AND something is missing do we escalate to a human.
export function classifySurvey(fields = {}) {
  const fico = ficoGatePasses(fields.svy_self_reported_fico ?? fields.cf_svy_self_reported_fico);
  const neg = negativesGatePasses(fields.svy_has_negatives ?? fields.cf_svy_has_negatives);

  if (fico === false || neg === false) return DOWNSELL;
  if (fico === null || neg === null) return MANUAL_REVIEW;
  return PASS;
}

// The funding call bucket (owner-set 2026-10-29). Two values, internal only.
// Capital Blueprint and credit repair share the unqualified bucket. The same people
// take both kinds of call. Stored on clients and bookings by migration 508.
export const FUNDING_QUALIFIED = "funding_qualified";
export const FUNDING_UNQUALIFIED = "funding_unqualified";
export const QUALIFICATION_BUCKETS = Object.freeze([FUNDING_QUALIFIED, FUNDING_UNQUALIFIED]);

// Use the same score and setter-correction rule as calendar links and Meta routing.
// The separate Stage 2 negative-mark gate does not split pre-call calendars.
export function qualificationBucket(fields = {}) {
  const tier = creditTierFor(fields);
  if (tier === null) return null;
  return tier === "qualified" ? FUNDING_QUALIFIED : FUNDING_UNQUALIFIED;
}

// stampQualificationBucket — save the client's bucket from their saved answers, then
// give it to any of their bookings that have none yet. A booking that already has a
// bucket keeps it (the 508 trigger holds that even against this update).
export async function stampQualificationBucket(db, clientId) {
  if (!clientId) return null;
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  if (!r.rows[0]) return null;
  const bucket = qualificationBucket(r.rows[0].custom_fields || {});
  if (!bucket) return null;
  await db.query(
    `UPDATE clients SET qualification_bucket = $2
      WHERE id = $1 AND qualification_bucket IS DISTINCT FROM $2`,
    [clientId, bucket]
  );
  await db.query(
    `UPDATE bookings SET qualification_bucket = $2
      WHERE client_id = $1 AND qualification_bucket IS NULL`,
    [clientId, bucket]
  );
  return bucket;
}

// currentQualification — read the survey answers off the client and classify.
// Returns PASS | DOWNSELL | MANUAL_REVIEW, or null when there is no client to read.
export async function currentQualification(db, clientId) {
  if (!clientId) return null;
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  if (!r.rows[0]) return null;
  return classifySurvey(r.rows[0].custom_fields || {});
}
