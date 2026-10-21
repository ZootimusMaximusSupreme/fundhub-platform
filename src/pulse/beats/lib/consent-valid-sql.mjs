// The consent validity predicate, in SQL, once.
//
// ONE RULE, TWO CLOCKS (2026-10-20). This fragment used to be VALID_PREDICATE in src/consent/index.mjs.
// It moved here, unchanged, so the hourly beats read the same rule the credit-pull gate uses (a beat may
// import only from src/pulse/beats/lib; the repair timeline under the progress read needs it).
// src/consent/index.mjs imports it back as VALID_PREDICATE and still exports CONSENT_VALID_SQL, so
// every caller keeps working. Change the rule here, nowhere else. Pure: no imports, no I/O.
//
// Every read that asks "is this usable" uses this exact fragment — a second copy that drifts by one
// boundary condition is the defect class this repo keeps finding, and here it would drift in the
// direction of allowing a credit pull.
//
// NOTE THE BOUNDARIES, both chosen deliberately:
//   expires_at > now()   — a consent expires AT its expiry, not after it.
//   granted_at <= now()  — a consent is live from the instant it is given.
// Together they mean a consent is never simultaneously not-yet and expired.

export const CONSENT_VALID_SQL = `
  revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now())
  AND granted_at <= now()`;
