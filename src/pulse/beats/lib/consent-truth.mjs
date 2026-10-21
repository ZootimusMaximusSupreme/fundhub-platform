// Consent rows that went missing: four readings of the database, read only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). These readings, their SQL and their helpers used to live in
// src/pulse/coverage/gap-consent.mjs. They moved here unchanged so the morning lane (which imports
// them back) and the hourly beat consent-capture run the same SQL and the same verdicts. A beat may
// import only from src/pulse/beats/lib, so the validity rule is a copy:
//   CONSENT_VALID_SQL   src/consent/index.mjs (the one rule the pull gate uses). beat-consent-capture.test.mjs
//                       holds the two strings equal, so they cannot drift by one boundary.
//
//   consent:required          a client who paid for a credit report has no live soft-pull consent
//   consent:store             a signed soft-pull paper has no consent row
//   consent:slo-store         a roadmap order saved the buyer's identity and no consent row
//   consent:dispute-required  an active repair client has neither a dispute authorization nor a signed agreement
//
// The page check (consent:page) needs a fetch and the registry, so it stays in the lane.
// It never records consent. Every statement is one SELECT.

import { OWNER_HOLD_CODE, isHeldCode, ownerHoldRow, stillOwnerHold } from "./owner-hold.mjs";

export { OWNER_HOLD_CODE };

/** Copy of CONSENT_VALID_SQL in src/consent/index.mjs, character for character (drift test). */
export const CONSENT_VALID_SQL = `
  revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now())
  AND granted_at <= now()`;

export const SOFT_PULL_KIND = "soft_pull_consent";

/** A payment this young may still be waiting for the buyer to fill in the form. */
export const PAID_GRACE_HOURS = 24;
/** A signed paper or a stored identity this young may still be mid-request. */
export const STORE_GRACE_HOURS = 1;
/** A stored identity older than this is old news, not a morning break. */
export const SLO_LOOKBACK_DAYS = 7;
/** A repair client gets this long to sign before "no authorization" is a morning break.
    The repair desk chases a missing contract after 3 business days (src/repair/sla.mjs);
    a week is that plus a weekend, so the desk has had its turn before the pulse speaks. */
export const DISPUTE_GRACE_DAYS = 7;

/* A test client is one nobody is selling to: the demo flag, the synthetic flag,
   the +walk-N / +sim-N tags the sim seeder writes into every address, or an
   address on a domain reserved for testing. Same pattern as gap-portal.mjs. */
export const TEST_CLIENT_EMAIL_RE =
  String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$`;

export const PAGE_FIX =
  "Restore the consent page so it loads and calls the capture API. Do not record consent for a real person from this check. Do not auto-fix.";
export const REQUIRED_FIX =
  "A client who paid for a credit report has no live written permission. Use the consent page with that client before any credit pull. Do not record consent for a real person from this check. Do not auto-fix.";
export const STORE_FIX =
  "A signed soft-pull paper has no stored consent row. Store it only through the existing capture path after a real yes. Do not record consent for a real person from this check. Do not auto-fix.";
export const DISPUTE_FIX =
  "A repair client has neither a live dispute authorization nor a signed repair agreement, so no letters can be prepared. Chase the signature through the consent page or the repair agreement. Do not record consent for a real person from this check. Do not auto-fix.";
export const SLO_FIX =
  "A buyer's identity was saved on the roadmap form and the consent row was not. Read the roadmap pull form and the consent capture. Do not record consent for a real person from this check. Do not auto-fix.";

/* Same test for "is this client a test client", written once and pasted into
   each statement with that statement's own alias and parameter number. */
function isTestClient(alias, param) {
  return `(COALESCE(${alias}.is_demo, false)
          OR COALESCE(${alias}.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(${alias}.email, '') ~* ${param})`;
}

/* Same population as needs_consent in src/fulfillment/read-signals.mjs.
   Paid for the report, credit not already in, no fraud chip ahead of consent,
   and no live soft-pull consent. The validity predicate is the one in
   src/consent/index.mjs — not a second copy.

   Two things the desk tile does not do, because the tile is a work queue and
   this is a morning alarm:
     * a client whose payment landed in the last 24 hours is left alone. They
       may be about to fill in the form, and the roadmap lets a buyer pay first.
     * test clients (see TEST_CLIENT_EMAIL_RE) are left out. */
export const REQUIRED_SQL = `
SELECT count(*)::int AS n
  FROM clients c
 WHERE c.org_id = $1::uuid
   AND ($2::boolean OR NOT ${isTestClient("c", "$4")})
   AND c.custom_fields->>'crs_paid' = 'true'
   AND TRIM(c.custom_fields->>'crs_status') IS DISTINCT FROM 'Complete'
   AND NOT EXISTS (
     SELECT 1 FROM crs_results cr
      WHERE cr.client_id = c.id
        AND cr.org_id = c.org_id
        AND COALESCE(cr.is_demo, false) = false)
   AND NOT (
     'fraud:alert-present' = ANY(COALESCE(c.tags, ARRAY[]::text[]))
     OR TRIM(COALESCE(c.custom_fields->>'round_hold_reason', '')) = 'Fraud Alert'
     OR EXISTS (
       SELECT 1 FROM inquiry_removal_cases irc
        WHERE irc.client_id = c.id
          AND irc.org_id = c.org_id
          AND NULLIF(TRIM(COALESCE(irc.fraud_alert_after, '')), '') IS NOT NULL))
   AND NOT EXISTS (
     SELECT 1 FROM events ev
      WHERE ev.org_id = c.org_id
        AND ev.client_id = c.id
        AND ev.name = 'diagnostic.paid'
        AND ev.created_at > now() - interval '${PAID_GRACE_HOURS} hours')
   AND NOT EXISTS (
     SELECT 1 FROM client_consents cc
      WHERE cc.client_id = c.id
        AND cc.org_id = c.org_id
        AND cc.kind = $3
        AND (${CONSENT_VALID_SQL}))`;

/* A signed soft-pull paper whose consent row never landed.
   A later withdrawal is not a failed store: the handler is supposed to refuse
   that replay. A missing signed PDF is a failed store — the paper path
   refuses to write a row when signed_document_id is null. A paper signed in
   the last hour is left alone: the handler may still be running. */
export const STORE_SQL = `
SELECT count(*)::int AS n
  FROM contracts ct
  JOIN clients c ON c.id = ct.client_id AND c.org_id = ct.org_id
 WHERE ct.org_id = $1::uuid
   AND ($2::boolean OR COALESCE(ct.is_demo, false) = false)
   AND ($2::boolean OR NOT ${isTestClient("c", "$3")})
   AND ct.status = 'signed'
   AND lower(trim(ct.kind)) = 'authorization'
   AND lower(trim(ct.subtype)) = 'soft_pull_consent'
   AND (ct.signed_at IS NULL OR ct.signed_at < now() - interval '${STORE_GRACE_HOURS} hour')
   AND NOT EXISTS (
     SELECT 1 FROM client_consents cc
      WHERE cc.org_id = ct.org_id
        AND cc.client_id = ct.client_id
        AND cc.kind = 'soft_pull_consent'
        AND cc.revoked_at IS NOT NULL
        AND ct.signed_at IS NOT NULL
        AND cc.revoked_at >= ct.signed_at)
   AND (
     ct.signed_document_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM client_consents cc
        WHERE cc.org_id = ct.org_id
          AND cc.document_id = ct.signed_document_id))`;

/* The roadmap pull form (src/slo/pull.mjs) saves the buyer's identity, stamps
   payment_links.identity_stored_at, and THEN captures the consent in the same
   request. An order that has the first and not the second lost the consent row.
   "No consent row at all" is the test, not "no live row": a buyer who withdrew
   later did store one. Repair buyers are not in this population, because their
   identity never goes through this form. */
export const SLO_STORE_SQL = `
SELECT count(*)::int AS n
  FROM payment_links pl
  JOIN clients c ON c.id = pl.client_id AND c.org_id = pl.org_id
 WHERE pl.org_id = $1::uuid
   AND left(pl.link_ref, 4) = 'slo_'
   AND ($2::boolean OR COALESCE(pl.is_demo, false) = false)
   AND ($2::boolean OR NOT ${isTestClient("c", "$3")})
   AND pl.identity_stored_at IS NOT NULL
   AND pl.identity_stored_at < now() - interval '${STORE_GRACE_HOURS} hour'
   AND pl.identity_stored_at > now() - interval '${SLO_LOOKBACK_DAYS} days'
   AND NOT EXISTS (
     SELECT 1 FROM client_consents cc
      WHERE cc.org_id = pl.org_id
        AND cc.client_id = pl.client_id
        AND cc.kind = 'soft_pull_consent')`;

/* A repair client the letters cannot be prepared for. analyzeAndGenerate
   (src/repair/analyze.mjs) refuses with "no_authorization" unless a signed repair
   agreement (hasRepairAgreement, src/repair/dispute-auth.mjs) OR a live
   dispute_authorization consent is on file, so those are the two things this
   looks for. The agreement test is copied from SIGNED_REPAIR_SQL there, and a
   test fails if that file changes it.
   Only active programs older than DISPUTE_GRACE_DAYS count: a new buyer is still
   signing. A client who withdrew an authorization (any revoked row) said no on
   purpose, which is not a break, the same way a withdrawal after signing is not
   a failed store above. Funding-offer clients also sign this paper but have no
   program row to read, so they are not in this population.
   It also names the clients (client codes), so a client on the owner's no-contact
   hold (src/pulse/owner-hold.mjs) can be told apart from everyone else. */
export const DISPUTE_SQL = `
SELECT count(*)::int AS n,
       COALESCE(array_agg(c.client_code ORDER BY c.client_code), ARRAY[]::text[]) AS codes
  FROM repair_programs rp
  JOIN clients c ON c.id = rp.client_id AND c.org_id = rp.org_id
 WHERE rp.org_id = $1::uuid
   AND ($2::boolean OR NOT ${isTestClient("c", "$3")})
   AND rp.status = 'active'
   AND rp.created_at < now() - interval '${DISPUTE_GRACE_DAYS} days'
   AND NOT EXISTS (
     SELECT 1 FROM client_consents cc
      WHERE cc.client_id = rp.client_id
        AND cc.org_id = rp.org_id
        AND cc.kind = 'dispute_authorization'
        AND (${CONSENT_VALID_SQL}))
   AND NOT EXISTS (
     SELECT 1 FROM client_consents cc
      WHERE cc.client_id = rp.client_id
        AND cc.org_id = rp.org_id
        AND cc.kind = 'dispute_authorization'
        AND cc.revoked_at IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM contracts k
       LEFT JOIN contract_templates t
         ON t.org_id = k.org_id AND t.template_key = k.template_key
      WHERE k.org_id = rp.org_id
        AND k.client_id = rp.client_id
        AND k.status = 'signed'
        AND (t.subtype = 'credit_repair' OR k.template_key ILIKE '%REPAIR%'))`;

export const READ_ONLY_SQL = Object.freeze([REQUIRED_SQL, STORE_SQL, SLO_STORE_SQL, DISPUTE_SQL]);

/** The four database readings, in the order the lane reports them. */
export const DB_CHECK_IDS = Object.freeze([
  "consent:required",
  "consent:store",
  "consent:slo-store",
  "consent:dispute-required"
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

export function assertSelect(sql) {
  const s = String(sql || "").trim();
  if (!/^(select|with)\b/i.test(s) || /\b(insert|update|delete|drop|alter|truncate)\b/i.test(s)) {
    throw new Error("consent gap check refused a write");
  }
}

function orgIdOf(io) {
  const id = typeof io.orgId === "string" ? io.orgId.trim() : "";
  return UUID_RE.test(id) ? id : "";
}

function canQuery(io) {
  return typeof io.scope === "function" || !!(io.db && typeof io.db.query === "function");
}

async function readCount(io, sql, params) {
  assertSelect(sql);
  if (typeof io.scope === "function") return io.scope((tx) => tx.query(sql, params));
  return io.db.query(sql, params);
}

function countRow(id, result, passDetail, failDetail, failFix, skipDetail) {
  if (result.skip) return check(id, "skip", skipDetail);
  if (result.fail) return check(id, "FAIL", result.fail, failFix);
  if (result.n > 0) return check(id, "FAIL", failDetail(result.n), failFix);
  return check(id, "PASS", passDetail);
}

async function countReading(io, sql, params) {
  try {
    const res = await readCount(io, sql, params);
    const raw = res && res.rows && res.rows[0] ? res.rows[0].n : null;
    const n = raw == null || raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n)) return { fail: "The consent read did not return a count." };
    const codes = res.rows[0].codes;
    return Array.isArray(codes) ? { n, codes } : { n };
  } catch (err) {
    return { fail: `Could not read consent rows: ${clip(err && err.message)}` };
  }
}

const DISPUTE_ID = "consent:dispute-required";

/* The held client codes when the reading named every row it counted and EVERY one is a
   client on the owner's no-contact hold, else null. */
function heldOnly(reading) {
  const list = Array.isArray(reading.codes) ? reading.codes.map((c) => (c == null ? "" : String(c).trim().toUpperCase())) : [];
  if (!list.length || list.length !== reading.n || !list.every(isHeldCode)) return null;
  return [...new Set(list)].sort();
}

/* Owner call 2026-10-09, said again 2026-10-20: Braum (FH-000507) gets no email, sign-in
   link, call or data step, so nobody may chase his signature. When every client this row
   finds is on that hold, the row is "nothing to judge" (OWNER_HOLD_CODE) and the audit
   reads it again every morning (verifyDisputeHold, through the lane's naVerify). Any other
   client keeps it red. */
function disputeRow(dispute, orgId, skipDetail) {
  if (!dispute.skip && !dispute.fail && dispute.n > 0) {
    const held = heldOnly(dispute);
    if (held) {
      return ownerHoldRow(DISPUTE_ID, orgId, held, {
        detail:
          `${dispute.n} active repair ${dispute.n === 1 ? "client has" : "clients have"} no dispute authorization and no signed repair agreement, ` +
          `and ${dispute.n === 1 ? "it is" : "they are"} ${held.join(" and ")}, on the owner's no-contact hold. ` +
          `Judged again the day another repair client is missing them.`
      });
    }
  }
  const r = READINGS[DISPUTE_ID];
  return countRow(DISPUTE_ID, dispute, r.pass, r.fail, r.fix, skipDetail);
}

/* The audit asks the lane again (src/pulse/self-audit.mjs, makeLaneNaVerify, via gap-consent's
   naVerify). True only when the same read still finds clients missing both papers and every one
   is a client the row named and the owner holds. A failed read, another client, or nobody is false. */
export async function verifyDisputeHold(args, io = {}) {
  if (!args || args.check !== DISPUTE_ID || typeof args.orgId !== "string" || !UUID_RE.test(args.orgId)) return false;
  if (!canQuery(io)) return false;
  const now = await countReading(io, DISPUTE_SQL, [args.orgId, false, TEST_CLIENT_EMAIL_RE]);
  return stillOwnerHold(disputeRow(now, args.orgId, ""), args);
}

/* Each database reading: its SQL, its parameters, and the words for each verdict. */
const READINGS = Object.freeze({
  "consent:required": Object.freeze({
    sql: REQUIRED_SQL,
    params: (orgId, demoOn) => [orgId, demoOn, SOFT_PULL_KIND, TEST_CLIENT_EMAIL_RE],
    pass: "No paid client is missing live soft-pull consent.",
    fail: (n) => `${n} ${n === 1 ? "client" : "clients"} paid for a credit report over ${PAID_GRACE_HOURS} hours ago and ${n === 1 ? "has" : "have"} no live soft-pull consent.`,
    fix: REQUIRED_FIX
  }),
  "consent:store": Object.freeze({
    sql: STORE_SQL,
    params: (orgId, demoOn) => [orgId, demoOn, TEST_CLIENT_EMAIL_RE],
    pass: "No signed soft-pull paper is missing its consent row.",
    fail: (n) => `${n} signed soft-pull ${n === 1 ? "paper has" : "papers have"} no consent row.`,
    fix: STORE_FIX
  }),
  "consent:slo-store": Object.freeze({
    sql: SLO_STORE_SQL,
    params: (orgId, demoOn) => [orgId, demoOn, TEST_CLIENT_EMAIL_RE],
    pass: `No roadmap order saved an identity in the last ${SLO_LOOKBACK_DAYS} days without saving its consent.`,
    fail: (n) => `${n} roadmap ${n === 1 ? "order saved" : "orders saved"} an identity and no consent row in the last ${SLO_LOOKBACK_DAYS} days.`,
    fix: SLO_FIX
  }),
  "consent:dispute-required": Object.freeze({
    sql: DISPUTE_SQL,
    params: (orgId, demoOn) => [orgId, demoOn, TEST_CLIENT_EMAIL_RE],
    pass: `No active repair client older than ${DISPUTE_GRACE_DAYS} days is missing a dispute authorization or a signed repair agreement.`,
    fail: (n) => `${n} active repair ${n === 1 ? "client has" : "clients have"} been enrolled over ${DISPUTE_GRACE_DAYS} days and ${n === 1 ? "has" : "have"} neither a live dispute authorization nor a signed repair agreement.`,
    fix: DISPUTE_FIX
  })
});

/**
 * The database readings, as morning rows. io: { db } or { scope }, orgId, demoOn.
 * `only` picks which readings run (default: all four, in DB_CHECK_IDS order). All selected
 * readings run at once. No database or no company is a skip that says which.
 * @returns {Promise<Array<{ id, status, detail, suggestedFix }>>}
 */
export async function consentDbChecks(io = {}, { only = DB_CHECK_IDS } = {}) {
  const ids = DB_CHECK_IDS.filter((id) => only.includes(id));
  const orgId = orgIdOf(io);
  const demoOn = io.demoOn === true;
  const ready = canQuery(io) && orgId;
  const results = ready
    ? await Promise.all(ids.map((id) => countReading(io, READINGS[id].sql, READINGS[id].params(orgId, demoOn))))
    : ids.map(() => ({ skip: true }));

  const noDb = "No database was passed in, so consent rows were not read.";
  const noOrg = "No company was passed in, so consent rows were not read.";
  const skipDetail = canQuery(io) && !orgId ? noOrg : noDb;
  return ids.map((id, i) => (id === DISPUTE_ID
    ? disputeRow(results[i], orgId, skipDetail)
    : countRow(id, results[i], READINGS[id].pass, READINGS[id].fail, READINGS[id].fix, skipDetail)));
}
