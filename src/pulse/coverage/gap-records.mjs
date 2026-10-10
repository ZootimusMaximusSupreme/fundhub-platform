// Customer records and the settings behind them. Report only. Read-only SQL.
//
// Four questions a client, or a client's bureau call, would feel:
//
//   privacy:erasure           "I asked to be erased and nothing happened."
//   privacy:pii-company       "Someone from another company opened my identity."
//   bureau-config:complete    "The AI caller has no number or menu for a bureau."
//   consent:recording-and-ads "Our recording or our ad has no permission behind it."
//
// Each is one SELECT. Nothing is written. A read that fails is a skip, never a PASS.
//
// ERASURE. Both erasure paths (src/privacy/erasure.mjs eraseClient and
// src/banking/revoke.mjs revokeBankLogin) write one erasure_requests row as
// 'completed', inside the same transaction as the removal. So 'requested' and
// 'failed' rows should not exist today. They are the shape a future queued or
// half-done path would leave, and the table allows them (migration 102). This
// check goes red the day one is left behind. A request that a later 'completed'
// row for the same person (and the same bank login) replaced is not red.
// The window for a 'requested' row is ERASURE_WINDOW_MS (below). No written
// window exists in the repo, so this is the pulse's own line: one morning report.
//
// PII COMPANY. api/pii.mjs checks the client id and the staff role, and no
// company (board leftover card, 2026-10-10). A reveal writes pii_access_log with
// the CLIENT's company and the staff member's id (accessed_by). So a row whose
// accessed_by is a staff id from a different company is a reveal across
// companies. Only reveals are logged (a masked read is not), so this sees
// reveals only. A system label in accessed_by (src/inquiry-ops/bureau-call.mjs
// writes "inquiry-bureau-call") has no staff row and cannot be judged; the PASS
// line says how many were that.
//
// BUREAU CONFIG. The AI caller dials three bureaus (BUREAU_CONFIGS in
// src/inquiry-ops/bureau-call.mjs: EX, EQ, TU). The table that holds each
// bureau's number and phone-menu path ships empty on purpose (migration 140,
// "do not invent phone numbers"). Measured 2026-10-10: nothing that places the
// call reads service_number or menu_path from this table (the call builders in
// vendor/inquiry-remover carry their own). The check still follows the owner's
// brief: a number and a menu path for each of the three, or red.
//
// CONSENT. call_recording and marketing_use (migration 291). Two readings, one
// row:
//   a recording saved (customer_insights.recording_url) for a client who had no
//     live call_recording consent when the row was saved;
//   a recording cleared for ads (marketing_cleared) whose client no longer holds
//     a live marketing_use consent. v_insight_ad_eligible already hides it from
//     the ad picker; the red is the reminder that a human cut or cleared it and
//     must now pull it.
// The live-consent rule is the one in src/consent/index.mjs (CONSENT_VALID_SQL).

import { CONSENT_VALID_SQL } from "../../consent/index.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";

export const ERASURE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PII_LOOKBACK_DAYS = 7;
export const PII_LOOKBACK_MS = PII_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

/** The bureaus the AI caller dials, in the order the call builders list them. */
export const DIALED_BUREAUS = Object.freeze(["EX", "EQ", "TU"]);

export const CHECK_IDS = Object.freeze([
  "privacy:erasure",
  "privacy:pii-company",
  "bureau-config:complete",
  "consent:recording-and-ads"
]);

export const ERASURE_SQL = `
  /* gap:privacy-erasure */
  SELECT count(*) FILTER (WHERE r.status = 'requested')::int AS waiting,
         count(*) FILTER (WHERE r.status = 'failed')::int AS failed,
         min(r.created_at) FILTER (WHERE r.status = 'requested') AS oldest_waiting,
         min(r.created_at) FILTER (WHERE r.status = 'failed') AS oldest_failed
    FROM erasure_requests r
   WHERE ($1::uuid IS NULL OR r.org_id = $1::uuid)
     AND (r.status = 'failed' OR (r.status = 'requested' AND r.created_at < $2::timestamptz))
     AND NOT EXISTS (
       SELECT 1 FROM erasure_requests d
        WHERE d.org_id = r.org_id
          AND d.kind = r.kind
          AND d.subject_client_id = r.subject_client_id
          AND d.subject_item_id IS NOT DISTINCT FROM r.subject_item_id
          AND d.status = 'completed'
          AND d.created_at > r.created_at)`;

export const PII_COMPANY_SQL = `
  /* gap:privacy-pii-company */
  SELECT count(*)::int AS reveals,
         count(s.id)::int AS by_staff,
         count(*) FILTER (WHERE s.id IS NOT NULL AND l.org_id IS DISTINCT FROM s.org_id)::int AS across,
         count(DISTINCT l.client_id) FILTER (WHERE s.id IS NOT NULL AND l.org_id IS DISTINCT FROM s.org_id)::int AS clients,
         count(DISTINCT s.id) FILTER (WHERE l.org_id IS DISTINCT FROM s.org_id)::int AS staff_n,
         max(l.created_at) FILTER (WHERE s.id IS NOT NULL AND l.org_id IS DISTINCT FROM s.org_id) AS latest
    FROM pii_access_log l
    LEFT JOIN staff s ON s.id::text = l.accessed_by
   WHERE l.created_at > $2::timestamptz
     AND ($1::uuid IS NULL OR l.org_id = $1::uuid OR s.org_id = $1::uuid)`;

export const BUREAU_SQL = `
  /* gap:bureau-config */
  SELECT upper(btrim(bureau_code)) AS bureau_code,
         COALESCE(active, true) AS active,
         (service_number IS NOT NULL AND btrim(service_number) <> '') AS has_number,
         (menu_path IS NOT NULL AND btrim(menu_path) <> '') AS has_menu
    FROM ai_bureau_config
   WHERE org_id = $1::uuid`;

/* Same test-client rule as the consent lane (TEST_CLIENT_EMAIL_RE). */
export const CONSENT_SQL = `
  /* gap:consent-recording-and-ads */
  SELECT count(*) FILTER (WHERE COALESCE(btrim(i.recording_url), '') <> '')::int AS recordings,
         count(*) FILTER (
           WHERE COALESCE(btrim(i.recording_url), '') <> ''
             AND NOT EXISTS (
               SELECT 1 FROM client_consents cc
                WHERE cc.org_id = i.org_id
                  AND cc.client_id = i.client_id
                  AND cc.kind = 'call_recording'
                  AND cc.granted_at <= i.created_at
                  AND (cc.revoked_at IS NULL OR cc.revoked_at > i.created_at)
                  AND (cc.expires_at IS NULL OR cc.expires_at > i.created_at))
         )::int AS recorded_no_consent,
         count(*) FILTER (WHERE i.marketing_cleared)::int AS cleared,
         count(*) FILTER (
           WHERE i.marketing_cleared
             AND NOT EXISTS (
               SELECT 1 FROM client_consents cc
                WHERE cc.org_id = i.org_id
                  AND cc.client_id = i.client_id
                  AND cc.kind = 'marketing_use'
                  AND (${CONSENT_VALID_SQL}))
         )::int AS cleared_no_consent
    FROM customer_insights i
    JOIN clients c ON c.id = i.client_id AND c.org_id = i.org_id
   WHERE i.org_id = $1::uuid
     AND ($2::boolean OR NOT (COALESCE(c.is_demo, false)
                              OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
                              OR COALESCE(c.email, '') ~* $3::text))`;

export const SQL = Object.freeze([ERASURE_SQL, PII_COMPANY_SQL, BUREAU_SQL, CONSENT_SQL]);

const TAIL = "Do not auto-fix. Chris fixes reds.";
const HOUR_MS = 60 * 60 * 1000;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  const db = ctx && ctx.db;
  if (db && typeof db.query === "function") return (fn) => fn(db);
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function noun(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function ageWords(ms) {
  const h = ms / HOUR_MS;
  if (h < 36) return `${Math.max(1, Math.round(h))} hours`;
  return `${Math.round(h / 24)} days`;
}

/** Refuses anything that is not one SELECT (a leading comment is allowed). Same words as gap-consent assertSelect. */
export function assertRead(sql) {
  const s = String(sql || "").replace(/^\s*\/\*[\s\S]*?\*\//, "").trim();
  if (!/^(select|with)\b/i.test(s) || /\b(insert|update|delete|drop|alter|truncate)\b/i.test(s)) {
    throw new Error("records gap check refused a write");
  }
}

async function rowsOf(run, sql, params) {
  assertRead(sql);
  const res = await run((db) => db.query(sql, params));
  return res && Array.isArray(res.rows) ? res.rows : [];
}

function readFailed(id, err) {
  return check(id, "skip", `The read for ${id} did not come back: ${clip((err && err.message) || err)}.`);
}

// ── privacy:erasure ──────────────────────────────────────────────────────────

export function judgeErasure(row, now) {
  const id = "privacy:erasure";
  const waiting = num(row.waiting);
  const failed = num(row.failed);
  if (waiting === 0 && failed === 0) {
    return check(id, "PASS", "No erasure or bank-revoke request is waiting or failed.");
  }
  const parts = [];
  if (waiting) {
    const o = toDate(row.oldest_waiting);
    const age = o ? ` (the oldest is ${ageWords(now.getTime() - o.getTime())} old)` : "";
    parts.push(`${noun(waiting, "request is", "requests are")} still 'requested' after a day${age}`);
  }
  if (failed) {
    const o = toDate(row.oldest_failed);
    const age = o ? ` (the oldest is ${ageWords(now.getTime() - o.getTime())} old)` : "";
    parts.push(`${noun(failed, "request", "requests")} failed and no later request for the same person finished${age}`);
  }
  return check(
    id,
    "FAIL",
    `${parts.join("; ")}. A person asked for their data to be removed and it has not been.`,
    `Open the erasure_requests row (failure_reason names why) and finish it through POST /api/privacy/erasure or /api/banking/revoke. ${TAIL}`
  );
}

// ── privacy:pii-company ──────────────────────────────────────────────────────

export function judgePiiCompany(row) {
  const id = "privacy:pii-company";
  const reveals = num(row.reveals);
  const across = num(row.across);
  if (across > 0) {
    return check(
      id,
      "FAIL",
      `${noun(across, "identity reveal was", "identity reveals were")} made by staff from a different company than the client ` +
        `(${noun(num(row.clients), "client", "clients")}, ${noun(num(row.staff_n), "staff member", "staff members")}, last ${PII_LOOKBACK_DAYS} days).`,
      `Read pii_access_log: accessed_by is the staff id, org_id is the client's company. api/pii.mjs checks the client id and not the company. ${TAIL}`
    );
  }
  const byStaff = num(row.by_staff);
  if (reveals === 0) {
    return check(id, "PASS", `No identity was revealed in the last ${PII_LOOKBACK_DAYS} days.`);
  }
  const system = reveals - byStaff;
  let who;
  if (byStaff === 0) who = "none could be matched to a named staff member (all were system labels)";
  else if (system === 0) who = "all were by a named staff member from the client's own company";
  else {
    who = `${byStaff} by a named staff member ${byStaff === 1 ? "was" : "were"} from the client's own company, ` +
      `and ${noun(system, "was a system label", "were system labels")} that cannot be matched to a person`;
  }
  return check(id, "PASS", `${noun(reveals, "identity reveal", "identity reveals")} in the last ${PII_LOOKBACK_DAYS} days; ${who}.`);
}

// ── bureau-config:complete ───────────────────────────────────────────────────

export function judgeBureauConfig(rows) {
  const id = "bureau-config:complete";
  const byCode = new Map();
  for (const r of rows) byCode.set(String(r.bureau_code || "").toUpperCase(), r);
  const missing = [];
  const noNumber = [];
  const noMenu = [];
  for (const code of DIALED_BUREAUS) {
    const r = byCode.get(code);
    if (!r) { missing.push(code); continue; }
    if (!r.has_number) noNumber.push(code);
    if (!r.has_menu) noMenu.push(code);
  }
  if (!missing.length && !noNumber.length && !noMenu.length) {
    return check(id, "PASS", `All ${DIALED_BUREAUS.length} bureaus the AI caller dials (${DIALED_BUREAUS.join(", ")}) have a number and a menu path.`);
  }
  const parts = [];
  if (missing.length) parts.push(`no row for ${missing.join(", ")}`);
  if (noNumber.length) parts.push(`no service number for ${noNumber.join(", ")}`);
  if (noMenu.length) parts.push(`no menu path for ${noMenu.join(", ")}`);
  return check(
    id,
    "FAIL",
    `The AI bureau config is not filled in: ${parts.join("; ")}.`,
    `Fill each bureau's service number and menu path on the Lenders page, AI bureau config tab (or POST /api/ai-bureau-config). Do not invent numbers: copy them from the bureau. ${TAIL}`
  );
}

// ── consent:recording-and-ads ────────────────────────────────────────────────

export function judgeRecordingConsent(row) {
  const id = "consent:recording-and-ads";
  const recordings = num(row.recordings);
  const noRec = num(row.recorded_no_consent);
  const cleared = num(row.cleared);
  const noAds = num(row.cleared_no_consent);
  if (noRec === 0 && noAds === 0) {
    return check(
      id,
      "PASS",
      `No saved recording lacks a call-recording consent, and no clip cleared for ads has lost its marketing consent ` +
        `(${noun(recordings, "recording", "recordings")} and ${noun(cleared, "cleared clip", "cleared clips")} read).`
    );
  }
  const parts = [];
  if (noRec) parts.push(`${noun(noRec, "saved recording has", "saved recordings have")} no call-recording consent that was live when it was saved`);
  if (noAds) parts.push(`${noun(noAds, "clip cleared for ads has", "clips cleared for ads have")} lost its marketing consent (revoked, expired or never there)`);
  return check(
    id,
    "FAIL",
    `${parts.join("; ")}.`,
    "For a recording, capture the consent through the consent page after a real yes, or remove the recording link. " +
      `For an ad clip, pull it from anything built or running and clear the flag. Do not record consent for a real person from this check. ${TAIL}`
  );
}

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * ctx: { db } or { scope }, optional { now, orgId, demoOn }. SELECT only.
 */
export async function gapChecks(ctx = {}) {
  const run = reader(ctx);
  if (!run) {
    return CHECK_IDS.map((id) => check(id, "skip", "No database in this run, so nothing was read."));
  }
  const now = toDate(ctx.now) || new Date();
  const orgId = ctx.orgId || null;
  const erasureCut = new Date(now.getTime() - ERASURE_WINDOW_MS).toISOString();
  const piiFrom = new Date(now.getTime() - PII_LOOKBACK_MS).toISOString();
  const demoOn = ctx.demoOn === true;

  const erasure = rowsOf(run, ERASURE_SQL, [orgId, erasureCut])
    .then((rows) => judgeErasure(rows[0] || {}, now))
    .catch((err) => readFailed("privacy:erasure", err));
  const pii = rowsOf(run, PII_COMPANY_SQL, [orgId, piiFrom])
    .then((rows) => judgePiiCompany(rows[0] || {}))
    .catch((err) => readFailed("privacy:pii-company", err));
  const bureau = !orgId
    ? Promise.resolve(check("bureau-config:complete", "skip", "No company came with this run, so the bureau config was not read."))
    : rowsOf(run, BUREAU_SQL, [orgId])
      .then((rows) => judgeBureauConfig(rows))
      .catch((err) => readFailed("bureau-config:complete", err));
  const consent = !orgId
    ? Promise.resolve(check("consent:recording-and-ads", "skip", "No company came with this run, so the recordings were not read."))
    : rowsOf(run, CONSENT_SQL, [orgId, demoOn, TEST_CLIENT_EMAIL_RE])
      .then((rows) => judgeRecordingConsent(rows[0] || {}))
      .catch((err) => readFailed("consent:recording-and-ads", err));

  return Promise.all([erasure, pii, bureau, consent]);
}
