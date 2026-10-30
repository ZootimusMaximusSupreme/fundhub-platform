// Survey qualification — the Stage 2 gate (05/30 source of truth, lines 36-44).
//
// Two gates, both must pass to book a funding call:
//   1. cf_svy_self_reported_fico is "700-749" or "750+"
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

export const PASS = "PASS";
export const DOWNSELL = "DOWNSELL";
export const MANUAL_REVIEW = "MANUAL_REVIEW";

// The full option set from the doc (lines 146, 5146). Order is the doc's, low to high.
export const FICO_BANDS = ["500-579", "580-649", "650-699", "700-749", "750+", "Not sure"];

// Only these two bands clear gate 1 (doc line 38).
export const PASSING_FICO_BANDS = ["700-749", "750+"];

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
  return PASSING_FICO_BANDS.includes(band);
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

// qualificationBucket — pure. Gate 1 decides; a definite "Yes" on negatives moves a
// passing score down. The /apply survey has no negatives question, so a missing
// negatives answer does not hold anyone back here (the pixel split uses the score only).
// No score answer yet -> null. Unknown, not guessed.
export function qualificationBucket(fields = {}) {
  const fico = ficoGatePasses(fields.svy_self_reported_fico ?? fields.cf_svy_self_reported_fico);
  if (fico === null) return null;
  const neg = negativesGatePasses(fields.svy_has_negatives ?? fields.cf_svy_has_negatives);
  return fico && neg !== false ? FUNDING_QUALIFIED : FUNDING_UNQUALIFIED;
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
