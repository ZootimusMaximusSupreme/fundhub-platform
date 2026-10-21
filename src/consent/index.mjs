// Consent — the gate that stands in front of a consumer-credit event.
//
// *** NOTHING HERE TRANSMITS. ***
// This module reads and writes one table (db/migrations/099_client_consents.sql)
// and asks one question: may we act on this person's credit right now. There is
// no outbound `fetch()` in src/adapters/ or src/lib/ and this does not add one.
//
//
// THE ONE RULE THIS MODULE ENFORCES.
//
// A consent is VALID only if all four are true, at the moment of asking:
//
//   1. it exists, for this client, of this kind, IN THIS ORG;
//   2. it has not been revoked;
//   3. it has not expired;
//   4. it has already started (granted_at is not in the future).
//
// Every one of those is evaluated IN THE SQL, against the database's clock, and
// not in JavaScript against the web server's. That is not a stylistic choice.
// Comparing `new Date()` to a timestamp read out of Postgres puts two clocks in
// a compliance decision, and the one that drifts is the one nobody monitors. A
// consent expiring is a question with exactly one right answer and one clock
// entitled to give it.
//
//
// FAIL CLOSED, EVERYWHERE, AND SPECIFICALLY ON THE ORG.
//
// A missing org does not mean "any org". It means we do not know who is asking,
// and a gate that does not know who is asking must not open. hasValidConsent()
// returns false for a missing or blank orgId rather than dropping the org from
// the WHERE clause — a scoped query with no scope is the bug that turns a
// per-tenant gate into a global one, and it looks like a small tidy-up in a
// diff. The org comes from the SESSION at the call site (staff.org_id, or the
// account principal's orgId); it is never read from a query string or a body.
//
// A missing clientId or an unknown kind is the same answer for the same reason.
// This function has no failure mode that produces `true`.
//
//
// THE NEWEST VALID ONE WINS, AND THERE IS NO UNIQUE INDEX.
//
// 099 deliberately allows many consent rows per (client, kind) — consent
// expires and is renewed, is revoked and later given afresh, and the wording
// changes and is re-consented. Its header explains why a unique index there is
// the same trap 077 documents for its own queued-request index. The rule "the
// current consent is the newest valid one" therefore lives here, in the ORDER
// BY, where it can be read.

import { db as sharedDb } from "../db.mjs";
import { CONSENT_VALID_SQL as VALID_PREDICATE } from "../pulse/beats/lib/consent-valid-sql.mjs";

export class ConsentError extends Error {
  constructor(message, { status = 400, code = "consent_error" } = {}) {
    super(message);
    this.name = "ConsentError";
    this.status = status;
    this.code = code;
  }
}

/** The kinds a consent row may carry. Mirrors the CHECK on client_consents.kind
 *  (099, extended by 167) and the `authorization` subtypes in
 *  src/documents/kinds.mjs.
 *
 *  A new kind here needs a migration, because the database constrains this
 *  column — see 099's header for why that set is closed rather than free text. */
export const CONSENT_KINDS = Object.freeze([
  "soft_pull_consent",
  "dispute_authorization",
  // Added 2026-09-05 with the CSM role. Two, not one: agreeing to be
  // recorded is not agreeing to be advertised, and a client may grant the
  // first and refuse the second. db/migrations/291 widens the CHECK.
  "call_recording",
  "marketing_use"
]);

/** How a consent was captured. Closed set of three, CHECKed in 099. */
export const CAPTURE_METHODS = Object.freeze(["typed", "checkbox", "signature"]);

/** Capture methods that require the consumer's name. A ticked box carries no
 *  name; a typed or signed consent that carries none is not one. Mirrors
 *  client_consents_method_ck. */
const METHODS_REQUIRING_NAME = new Set(["typed", "signature"]);

/* Why a consent is not usable. These strings are returned to the caller and
   surfaced on screen, so they are written to be read by a person deciding what
   to do next, not by a developer reading a stack trace. */
export const CONSENT_REASONS = Object.freeze({
  OK: "valid",
  NONE: "none_on_file",
  REVOKED: "revoked",
  EXPIRED: "expired",
  NOT_YET: "not_yet_effective",
  NO_ORG: "no_org_scope",
  BAD_INPUT: "bad_input"
});

const SELECT_COLUMNS = `
  id, org_id, client_id, kind,
  consent_text, consent_version,
  granted_by_kind, granted_by_account_id, granted_by_staff_id,
  capture_method, granted_name, captured_ip, captured_user_agent,
  document_id, granted_at, expires_at,
  revoked_at, revoked_reason, revoked_by_kind,
  revoked_by_account_id, revoked_by_staff_id,
  created_at, updated_at`;

/* The validity predicate, in SQL, once. Every read that asks "is this usable"
   uses this exact fragment — a second copy that drifts by one boundary
   condition is the defect class this repo keeps finding, and here it would
   drift in the direction of allowing a credit pull.

   NOTE THE BOUNDARIES, both chosen deliberately:
     expires_at > now()   — a consent expires AT its expiry, not after it.
     granted_at <= now()  — a consent is live from the instant it is given.
   Together they mean a consent is never simultaneously not-yet and expired.

   THE ONE COPY LIVES IN src/pulse/beats/lib/consent-valid-sql.mjs (2026-10-20),
   unchanged, so the hourly beats read the same rule (a beat may import only from
   the beat library). Imported back at the top of this file under its old name,
   VALID_PREDICATE. */

/* The same fragment, exported, so a reader that CANNOT call consentStatus()
   still cannot fork the rule.

   ADDITIVE ONLY — nothing in this module's behaviour changes and the constant
   above remains the one definition. It is exported because a list screen asking
   "which of these 500 clients has live permission" cannot call consentStatus()
   500 times, and the only alternative to exporting is a second hand-typed copy
   of a credit-pull gate sitting in a dashboard read. This header's own warning
   is the reason: that copy would drift, and it would drift in the direction of
   allowing a pull.

   A caller using this MUST also mirror consentStatus()'s ORDER BY — valid rows
   first, then newest granted_at, then id — or it will judge a different row
   than the gate does. src/fulfillment/read-signals.mjs is the one caller. */
export const CONSENT_VALID_SQL = VALID_PREDICATE;

const blank = (v) => typeof v !== "string" || !v.trim();
const trimmed = (v) => (typeof v === "string" ? v.trim() : v);

/**
 * consentStatus — the full answer: is there a usable consent, and if not, why.
 *
 * Returns { valid, reason, consent } where `consent` is the row the verdict is
 * about (the newest valid one, or — when nothing is valid — the newest one of
 * any state, so a screen can say "revoked on the 4th" rather than "none").
 * Never throws for a bad argument: an unanswerable question is answered `false`.
 *
 * This is the function screens call. requestSoftPull() calls hasValidConsent()
 * below, which is this with the detail dropped.
 */
export async function consentStatus(db, { orgId, clientId, kind } = {}) {
  // FAIL CLOSED. Each of these is "we cannot tell", and "we cannot tell" is not
  // permission. See the header — no branch here can produce valid:true.
  if (blank(orgId)) return { valid: false, reason: CONSENT_REASONS.NO_ORG, consent: null };
  if (blank(clientId)) return { valid: false, reason: CONSENT_REASONS.BAD_INPUT, consent: null };
  if (!CONSENT_KINDS.includes(kind)) {
    return { valid: false, reason: CONSENT_REASONS.BAD_INPUT, consent: null };
  }

  // One query, two answers: `is_valid` per row from the same predicate the
  // ORDER BY ranks on. Asking the database to evaluate validity AND to rank by
  // it in one statement is what keeps the verdict and the explanation from
  // being able to disagree — two round trips could observe two different
  // now() values and report "valid" about a row the gate had just rejected.
  const res = await db.query(
    `SELECT ${SELECT_COLUMNS},
            (${VALID_PREDICATE}) AS is_valid
       FROM client_consents
      WHERE org_id = $1 AND client_id = $2 AND kind = $3
      ORDER BY (${VALID_PREDICATE}) DESC, granted_at DESC, id DESC
      LIMIT 1`,
    [String(orgId).trim(), String(clientId).trim(), kind]
  );

  const row = res.rows[0];
  if (!row) return { valid: false, reason: CONSENT_REASONS.NONE, consent: null };

  const consent = decorate(row);
  if (row.is_valid) return { valid: true, reason: CONSENT_REASONS.OK, consent };

  // Not valid — say which of the three ways. Order matters: a revoked consent
  // that has also expired is REVOKED, because that is the fact the consumer
  // acted on and the one they would expect to be told.
  let reason = CONSENT_REASONS.EXPIRED;
  if (row.revoked_at) reason = CONSENT_REASONS.REVOKED;
  else if (row.granted_at && new Date(row.granted_at) > new Date()) reason = CONSENT_REASONS.NOT_YET;

  return { valid: false, reason, consent };
}

/**
 * hasValidConsent — the gate. `true` only if this client, in this org, has a
 * live, unrevoked, unexpired consent of this kind right now.
 *
 * SIGNATURE NOTE. The brief named this `hasValidConsent(clientId, kind)`. It
 * takes a db handle first and its subject in an options object, because every
 * other data function in this repository does (see src/finance/soft-pulls.mjs,
 * src/tradelines/store.mjs) and because it MUST take an org: org scoping comes
 * from the session and a gate that cannot be scoped cannot fail closed. The
 * question it answers is unchanged — clientId and kind are still the subject.
 */
export async function hasValidConsent(db, { orgId, clientId, kind } = {}) {
  const status = await consentStatus(db, { orgId, clientId, kind });
  return status.valid;
}

/**
 * decorate — the row as callers should see it.
 *
 * `is_valid` from the SQL is surfaced as a real boolean, and the raw column is
 * dropped so no screen can read the pre-computed value and the live one from
 * the same object and pick the wrong one.
 */
export function decorate(row) {
  if (!row) return row;
  const { is_valid, ...rest } = row;
  return { ...rest, valid: is_valid === true };
}

/* normalizeConsentText — the words, or a refusal.
 *
 * "   " is refused as hard as "" is, and for the reason 077's header sets out
 * for its `reason` column: a whitespace value satisfies a NOT NULL, looks
 * populated in an audit export, and says nothing. Here it would be worse than
 * nothing — it would be a consent record whose evidence is blank.
 *
 * A non-string is a 400 rather than being coerced, so that neither "42" nor
 * "[object Object]" can become the sentence somebody is later recorded as
 * having agreed to. */
export function normalizeConsentText(text) {
  if (blank(text)) {
    throw new ConsentError(
      "consent_text is required — a consent record must hold the exact words the person was shown",
      { status: 400, code: "consent_text_required" }
    );
  }
  return text.trim();
}

/** normalizeCaptureMethod — one of the three, or a refusal. Not defaulted:
 *  guessing how somebody consented is inventing evidence. */
export function normalizeCaptureMethod(method) {
  const m = String(method ?? "").trim().toLowerCase();
  if (!CAPTURE_METHODS.includes(m)) {
    throw new ConsentError(
      `capture_method must be one of: ${CAPTURE_METHODS.join(", ")}`,
      { status: 400, code: "capture_method_invalid" }
    );
  }
  return m;
}

/* normalizeGranter — a principal-ish thing → { kind, accountId, staffId }.
 *
 * Same shape and same refusal as normalizeRequester() in
 * src/finance/soft-pulls.mjs: anything that does not resolve to a kind AND a
 * subject is a 401, never a default. An unattributed consent is not a consent,
 * and 099 backs this with a CHECK so the refusal holds against a writer that
 * never came through this module. */
export function normalizeGranter(grantedBy) {
  const kind = String(grantedBy?.kind ?? "").trim().toLowerCase();
  const id = grantedBy?.id ?? (kind === "staff" ? grantedBy?.staffId : grantedBy?.accountId);

  if (!kind || !id) {
    throw new ConsentError(
      "grantedBy is required — an unattributed consent is not evidence of anything",
      { status: 401, code: "granter_required" }
    );
  }
  if (kind !== "client" && kind !== "staff") {
    throw new ConsentError(
      "grantedBy.kind must be one of: client, staff",
      { status: 400, code: "granter_kind_invalid" }
    );
  }
  return {
    kind,
    accountId: kind === "client" ? String(id) : null,
    staffId: kind === "staff" ? String(id) : null
  };
}

/**
 * captureConsent — record that a person agreed, in the words they were shown.
 *
 * Every argument that an auditor would read is required and validated here as
 * well as in the schema. The duplication is deliberate and is the same posture
 * api/finance/soft-pull.mjs takes on its reason field: the constraint is the
 * control, and the module check is what turns a Postgres error string into an
 * answer the caller can act on.
 *
 * NOT IDEMPOTENT, AND NOT DEDUPLICATED. Two consents captured a minute apart
 * are two rows, because they are two events — see 099 on why there is no unique
 * index. A double-submit therefore writes two identical-looking consents, which
 * is harmless (the gate reads the newest valid one) and honest. Collapsing them
 * would mean deciding that one of two things a person did never happened.
 */
export async function captureConsent(db, {
  orgId,
  clientId,
  kind,
  consentText,
  consentVersion = null,
  grantedBy,
  captureMethod,
  grantedName = null,
  capturedIp = null,
  capturedUserAgent = null,
  documentId = null,
  expiresAt = null
} = {}) {
  if (blank(orgId)) {
    throw new ConsentError(
      "orgId is required — a consent belongs to the org that captured it",
      { status: 400, code: "org_required" }
    );
  }
  if (blank(clientId)) {
    throw new ConsentError("clientId is required", { status: 400, code: "client_required" });
  }
  if (!CONSENT_KINDS.includes(kind)) {
    throw new ConsentError(
      `kind must be one of: ${CONSENT_KINDS.join(", ")}`,
      { status: 400, code: "kind_invalid" }
    );
  }

  // Attribution first, before anything touches the database — the same order
  // requestSoftPull() uses, and for the same reason: a record that cannot say
  // who made it is not one we are willing to have half-written.
  const granter = normalizeGranter(grantedBy);
  const text = normalizeConsentText(consentText);
  const method = normalizeCaptureMethod(captureMethod);

  const name = blank(grantedName) ? null : grantedName.trim();
  if (METHODS_REQUIRING_NAME.has(method) && !name) {
    throw new ConsentError(
      `a ${method} consent must carry the name the person typed or signed`,
      { status: 400, code: "granted_name_required" }
    );
  }

  const expiry = normalizeExpiry(expiresAt);

  const res = await db.query(
    `INSERT INTO client_consents
       (org_id, client_id, kind, consent_text, consent_version,
        granted_by_kind, granted_by_account_id, granted_by_staff_id,
        capture_method, granted_name, captured_ip, captured_user_agent,
        document_id, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING ${SELECT_COLUMNS}`,
    [
      String(orgId).trim(), String(clientId).trim(), kind, text,
      blank(consentVersion) ? null : consentVersion.trim(),
      granter.kind, granter.accountId, granter.staffId,
      method, name,
      blank(capturedIp) ? null : capturedIp.trim(),
      blank(capturedUserAgent) ? null : capturedUserAgent.trim(),
      blank(documentId) ? null : String(documentId).trim(),
      expiry
    ]
  );

  return decorate({ ...res.rows[0], is_valid: true });
}

/* normalizeExpiry — a Date, an ISO string, or null meaning "does not expire".
 *
 * An unparseable value is refused rather than dropped to null. Silently
 * treating "next Tuesday" as "never expires" would extend a consent
 * indefinitely because somebody typed the wrong thing into a form, which is the
 * one direction this system must not fail in. */
export function normalizeExpiry(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new ConsentError(
      `expires_at is not a date I can read (got ${JSON.stringify(value)})`,
      { status: 400, code: "expires_at_invalid" }
    );
  }
  return d;
}

/**
 * revokeConsent — the consumer takes permission back.
 *
 * ONE WAY, AND IMMEDIATE. The UPDATE is guarded on `revoked_at IS NULL`, so a
 * second revocation of the same row does not overwrite the first one's reason
 * or timestamp — the moment permission was withdrawn is the fact that matters
 * and it is not editable. 099's trigger refuses the same thing at the table, so
 * this holds against a writer that never came through here.
 *
 * A stated reason is required, on the same reasoning as closeSoftPull(): "it
 * ended" is not an audit trail.
 *
 * There is no unrevoke(). Granting permission again is captureConsent().
 */
export async function revokeConsent(db, { orgId, consentId, reason, revokedBy } = {}) {
  if (blank(orgId)) {
    throw new ConsentError("orgId is required", { status: 400, code: "org_required" });
  }
  if (blank(consentId)) {
    throw new ConsentError("consentId is required", { status: 400, code: "consent_required" });
  }
  if (blank(reason)) {
    throw new ConsentError(
      "a reason is required — every revocation is written to client_consents",
      { status: 400, code: "reason_required" }
    );
  }
  const revoker = normalizeGranter(revokedBy);

  // org_id IS IN THE WHERE CLAUSE, not merely checked after the read. A revoke
  // scoped only by id would let a caller in org A withdraw a consent belonging
  // to org B by guessing a uuid; scoping the write itself means the row is
  // invisible rather than merely refused.
  const res = await db.query(
    `UPDATE client_consents
        SET revoked_at = now(), revoked_reason = $3,
            revoked_by_kind = $4, revoked_by_account_id = $5, revoked_by_staff_id = $6,
            updated_at = now()
      WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL
      RETURNING ${SELECT_COLUMNS}`,
    [String(consentId).trim(), String(orgId).trim(), reason.trim(),
     revoker.kind, revoker.accountId, revoker.staffId]
  );

  if (!res.rows[0]) {
    // Either it does not exist, belongs to another org, or is already revoked.
    // All three mean "this call did not do what it was asked", and none of them
    // should look like success. They are not distinguished in the message: the
    // difference is only useful to somebody probing for which uuids are real.
    throw new ConsentError(
      "no live consent with that id",
      { status: 409, code: "not_revocable" }
    );
  }

  return decorate({ ...res.rows[0], is_valid: false });
}

/**
 * listConsents — one client's consent history, newest first, including revoked
 * and expired rows.
 *
 * This is the read the phrase "what has this person agreed to, and what did
 * they take back" resolves to. Revoked rows are INCLUDED deliberately: a
 * history that hides withdrawals is not a history.
 */
export async function listConsents(db, { orgId, clientId, kind = null, limit = 50 } = {}) {
  if (blank(orgId)) return [];          // fail closed, same as the gate
  if (blank(clientId)) {
    throw new ConsentError("clientId is required", { status: 400, code: "client_required" });
  }
  const capped = boundedLimit(limit);

  const params = [String(orgId).trim(), String(clientId).trim(), capped];
  let kindFilter = "";
  if (kind !== null && kind !== undefined && kind !== "") {
    if (!CONSENT_KINDS.includes(kind)) {
      throw new ConsentError(
        `kind must be one of: ${CONSENT_KINDS.join(", ")}`,
        { status: 400, code: "kind_invalid" }
      );
    }
    params.push(kind);
    kindFilter = ` AND kind = $${params.length}`;
  }

  const res = await db.query(
    `SELECT ${SELECT_COLUMNS},
            (${VALID_PREDICATE}) AS is_valid
       FROM client_consents
      WHERE org_id = $1 AND client_id = $2${kindFilter}
      ORDER BY granted_at DESC, id DESC
      LIMIT $3`,
    params
  );
  return res.rows.map(decorate);
}

/* boundedLimit — clamps both ends and treats a non-positive limit as "use the
   default" rather than as a number. Lifted from src/finance/soft-pulls.mjs,
   whose comment explains why `Math.min(parseInt(q.limit) || 100, 200)` lets -1
   through and 500s with raw Postgres text. Same behaviour, so the two endpoints
   answer a bad ?limit= the same way. */
export function boundedLimit(raw, fallback = 50) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 200);
}

/** The default handle, for callers that do not pass one. Same convention as the
 *  rest of the repo — the export exists so tests can hand in a fake. */
export const defaultDb = sharedDb;
