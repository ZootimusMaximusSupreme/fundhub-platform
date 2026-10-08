// Consent capture — one tripwire for the morning pulse.
// Read only. It never records consent and it never starts another monitor.
//
// The morning pulse already pings the consent page and the consent API
// (reg:consent-capture and reg:consent/capture in the registry). This file does
// not ping the API again. It reads the page body once, to see that the page
// still talks to the capture API, and it reads the database for the three ways
// a consent goes missing.
//
// It does NOT look at files on disk. The pulse runs inside the deployed
// function, where public/ and api/ are not there to read.

import { CONSENT_VALID_SQL } from "../../consent/index.mjs";
import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const CONSENT_PAGE_PATH = "/app/consent-capture.html";
export const CONSENT_API_PATH = "/api/consent/capture";
export const SOFT_PULL_KIND = "soft_pull_consent";
export const CHECK_IDS = Object.freeze([
  "consent:page",
  "consent:required",
  "consent:store",
  "consent:slo-store"
]);

/** A payment this young may still be waiting for the buyer to fill in the form. */
export const PAID_GRACE_HOURS = 24;
/** A signed paper or a stored identity this young may still be mid-request. */
export const STORE_GRACE_HOURS = 1;
/** A stored identity older than this is old news, not a morning break. */
export const SLO_LOOKBACK_DAYS = 7;

/* A test client is one nobody is selling to: the demo flag, the synthetic flag,
   the +walk-N / +sim-N tags the sim seeder writes into every address, or an
   address on a domain reserved for testing. Same pattern as gap-portal.mjs. */
export const TEST_CLIENT_EMAIL_RE =
  String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost)$`;

const PAGE_FIX =
  "Restore the consent page so it loads and calls the capture API. Do not record consent for a real person from this check. Do not auto-fix.";
const REQUIRED_FIX =
  "A client who paid for a credit report has no live written permission. Use the consent page with that client before any credit pull. Do not record consent for a real person from this check. Do not auto-fix.";
const STORE_FIX =
  "A signed soft-pull paper has no stored consent row. Store it only through the existing capture path after a real yes. Do not record consent for a real person from this check. Do not auto-fix.";
const SLO_FIX =
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

export const READ_ONLY_SQL = Object.freeze([REQUIRED_SQL, STORE_SQL, SLO_STORE_SQL]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

/** Page: any 2xx. API: also 400, 401, 403, 405 (a bare GET is refused on purpose). */
export function doorUp(kind, status) {
  const n = Number(status);
  if (!Number.isInteger(n)) return false;
  if (kind === "page") return n >= 200 && n < 300;
  return (n >= 200 && n < 300) || n === 400 || n === 401 || n === 403 || n === 405;
}

/* Not read by the morning run: registry.test.mjs already fails when a door is
   missing from the list. Kept because the test file proves it from here too. */
export function consentDoorsListed(registry = PULSE_REGISTRY) {
  const keys = new Set((registry || []).map((row) => coverageKey(row)));
  return keys.has("consent-capture.html") && keys.has("consent/capture");
}

export function assertSelect(sql) {
  const s = String(sql || "").trim();
  if (!/^(select|with)\b/i.test(s) || /\b(insert|update|delete|drop|alter|truncate)\b/i.test(s)) {
    throw new Error("consent gap check refused a write");
  }
}

/**
 * GET the consent page once. The API door itself is the registry's job.
 * What this adds: a 200 that is not the capture page (or a page that no longer
 * calls the capture API) is a dead page the plain ping calls up.
 */
async function pageRow(ctx) {
  const id = "consent:page";
  const fetchImpl = ctx.fetchImpl || ctx.fetch;
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "No fetch was passed in, so the consent page was not read.");
  }
  const origin = String(ctx.baseUrl || "https://fundhub.ai").replace(/\/+$/, "");
  const url = `${origin}${CONSENT_PAGE_PATH}`;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(15000)
    });
    const status = res && res.status;
    if (!doorUp("page", status)) {
      return check(id, "FAIL", `${CONSENT_PAGE_PATH} answered ${status}.`, PAGE_FIX);
    }
    const text = res && typeof res.text === "function" ? String(await res.text()) : "";
    if (!text.includes(CONSENT_API_PATH)) {
      return check(
        id,
        "FAIL",
        `${CONSENT_PAGE_PATH} answered ${status} but does not call ${CONSENT_API_PATH}.`,
        PAGE_FIX
      );
    }
    return check(id, "PASS", `${CONSENT_PAGE_PATH} answered ${status} and calls the capture API.`);
  } catch (err) {
    return check(id, "FAIL", `${CONSENT_PAGE_PATH} unreachable: ${clip(err && err.message)}`, PAGE_FIX);
  }
}

function orgIdOf(ctx) {
  const id = typeof ctx.orgId === "string" ? ctx.orgId.trim() : "";
  return UUID_RE.test(id) ? id : "";
}

function canQuery(ctx) {
  return typeof ctx.scope === "function" || !!(ctx.db && typeof ctx.db.query === "function");
}

async function readCount(ctx, sql, params) {
  assertSelect(sql);
  if (typeof ctx.scope === "function") return ctx.scope((tx) => tx.query(sql, params));
  return ctx.db.query(sql, params);
}

function countRow(id, result, passDetail, failDetail, failFix, skipDetail) {
  if (result.skip) return check(id, "skip", skipDetail);
  if (result.fail) return check(id, "FAIL", result.fail, failFix);
  if (result.n > 0) return check(id, "FAIL", failDetail(result.n), failFix);
  return check(id, "PASS", passDetail);
}

async function countReading(ctx, sql, params) {
  try {
    const res = await readCount(ctx, sql, params);
    const raw = res && res.rows && res.rows[0] ? res.rows[0].n : null;
    const n = raw == null || raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n)) return { fail: "The consent read did not return a count." };
    return { n };
  } catch (err) {
    return { fail: `Could not read consent rows: ${clip(err && err.message)}` };
  }
}

/**
 * Consent capture gap. One tripwire, four readings.
 * @param {object} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  try {
    const page = await pageRow(ctx);

    const orgId = orgIdOf(ctx);
    const demoOn = ctx.demoOn === true;
    let required;
    let store;
    let sloStore;
    if (!canQuery(ctx) || !orgId) {
      required = { skip: true };
      store = { skip: true };
      sloStore = { skip: true };
    } else {
      [required, store, sloStore] = await Promise.all([
        countReading(ctx, REQUIRED_SQL, [orgId, demoOn, SOFT_PULL_KIND, TEST_CLIENT_EMAIL_RE]),
        countReading(ctx, STORE_SQL, [orgId, demoOn, TEST_CLIENT_EMAIL_RE]),
        countReading(ctx, SLO_STORE_SQL, [orgId, demoOn, TEST_CLIENT_EMAIL_RE])
      ]);
    }

    const noDb = "No database was passed in, so consent rows were not read.";
    const noOrg = "No company was passed in, so consent rows were not read.";
    const skipDetail = canQuery(ctx) && !orgId ? noOrg : noDb;

    return [
      page,
      countRow(
        "consent:required",
        required,
        "No paid client is missing live soft-pull consent.",
        (n) => `${n} ${n === 1 ? "client" : "clients"} paid for a credit report over ${PAID_GRACE_HOURS} hours ago and ${n === 1 ? "has" : "have"} no live soft-pull consent.`,
        REQUIRED_FIX,
        skipDetail
      ),
      countRow(
        "consent:store",
        store,
        "No signed soft-pull paper is missing its consent row.",
        (n) => `${n} signed soft-pull ${n === 1 ? "paper has" : "papers have"} no consent row.`,
        STORE_FIX,
        skipDetail
      ),
      countRow(
        "consent:slo-store",
        sloStore,
        `No roadmap order saved an identity in the last ${SLO_LOOKBACK_DAYS} days without saving its consent.`,
        (n) => `${n} roadmap ${n === 1 ? "order saved" : "orders saved"} an identity and no consent row in the last ${SLO_LOOKBACK_DAYS} days.`,
        SLO_FIX,
        skipDetail
      )
    ];
  } catch (err) {
    const detail = `Consent check stopped: ${clip(err && err.message)}`;
    return [
      check("consent:page", "FAIL", detail, PAGE_FIX),
      check("consent:required", "FAIL", detail, REQUIRED_FIX),
      check("consent:store", "FAIL", detail, STORE_FIX),
      check("consent:slo-store", "FAIL", detail, SLO_FIX)
    ];
  }
}
