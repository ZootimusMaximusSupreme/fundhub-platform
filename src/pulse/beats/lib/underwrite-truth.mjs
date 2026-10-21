// The UnderwriteIQ pack a paid roadmap buyer is owed, read only: is it there, is it whole, was the
// buyer told.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). These three checks, their SQL and their judges used to live in
// src/pulse/coverage/gap-underwrite.mjs. They moved here unchanged so the morning lane (which imports
// them back) and the hourly beat roadmap-delivery run the same SQL and the same verdicts, and so the
// roadmap trip (lib/roadmap-trip-truth.mjs) can call judgePackFiles and judgePackEmail on one buyer.
// A beat may import only from src/pulse/beats/lib, so the draft-template test comes from
// ./auth-truth.mjs (a copy of src/messaging/draft-guard.mjs held equal by beat-auth-links.test.mjs).
//
//   uw-paid-roadmap-no-pack     a paid roadmap buyer's credit pull finished 2 hours ago and no pack file exists
//   uw-pack-files-incomplete    a saved pack is missing a promised file, has an empty file, or came from
//                               the short fallback printer
//   uw-pack-email-not-queued    a buyer owed the pack-ready email has none queued, or the template that
//                               email is sent from is missing, a draft, or not approved
//
// db is anything with query(sql, params). Never pulls credit. Never charges. Never writes.

import { isDraftTemplateRow } from "./auth-truth.mjs";

export const GRACE_MS = 2 * 60 * 60 * 1000;
/** The four files every funding pack stores. A bonus file is not the pack. */
export const PACK_SUBTYPES = Object.freeze([
  "credit_analysis_report",
  "credit_optimization_roadmap",
  "funding_snapshot",
  "bank_lender_match_list"
]);
// ── Tier 1, Claude 2026-10-09: is the pack whole, and was the buyer told? ──
//
// uw-paid-roadmap-no-pack only goes red when NONE of the four core files exist.
// A pack that saved three of five, or saved a file with no bytes, stayed green.
// And nothing read whether the "your pack is ready" email was ever queued.
// These two read the rows and judge in JavaScript, so a test can feed them real
// shapes. The SQL only gathers facts.

/** Wait this long after the newest pack file before judging. Files save one by one, seconds apart. */
export const PACK_SETTLE_MS = 30 * 60 * 1000;
/**
 * The five files the pack email promises: the four core pages and the Capital Readiness Summary.
 * The summary is owed only on a funding credit tier (see SUMMARY_OWED_TIERS below).
 */
export const PACK_REQUIRED_SUBTYPES = Object.freeze([...PACK_SUBTYPES, "funding_summary"]);
/**
 * Every subtype that counts as "this client has a pack". The Business Readiness
 * Guide (business_prep_summary) is only built for a thin-file or authorized-user
 * client (src/underwrite/funding-letter-pdf.mjs), so it is never required. The
 * Business Duplication Map is required only of a roadmap buyer (see MAP_OWED_FROM).
 */
export const PACK_ANCHOR_SUBTYPES = Object.freeze([
  ...PACK_REQUIRED_SUBTYPES,
  "business_prep_summary",
  "business_duplication_map"
]);
/** What a buyer reads. Subtype to the title on the document row. */
export const PACK_FILE_NAMES = Object.freeze({
  credit_analysis_report: "Credit Analysis Report",
  credit_optimization_roadmap: "Credit Optimization Roadmap",
  funding_snapshot: "Funding Snapshot",
  bank_lender_match_list: "Bank and Lender Match List",
  funding_summary: "Capital Readiness Summary",
  business_prep_summary: "Business Readiness Guide",
  business_duplication_map: "Business Duplication Map"
});
/**
 * The map is the free bonus of the $297 roadmap. The code that builds it landed
 * 2026-10-02 (commit 1cc1a1ee, 08:14 Arizona). A roadmap pack first saved on or
 * after this date must hold one. An earlier pack never could, so it is not a break.
 */
export const MAP_OWED_FROM = "2026-10-03T00:00:00.000Z";
/**
 * The Capital Readiness Summary (funding_summary) is made only on the funding
 * package. The engine builds one of three packages from the credit tier
 * (vendor/underwriteiq-full/api/lite/crs/build-documents.js):
 *   FULL_FUNDING, FUNDING_PLUS_REPAIR, PREMIUM_STACK  -> funding package, summary made
 *   REPAIR_ONLY                                       -> repair package, no funding summary
 *   FRAUD_HOLD, MANUAL_REVIEW                         -> hold package, no summary
 * So a pack with no summary is a break only when the credit file was a funding
 * tier. A test runs the real buildDocuments over every tier and pins both lists.
 * This is a lane rule, not a fix: the pack email lists the summary for everyone
 * (see the leftover card on the lane board).
 */
export const SUMMARY_OWED_TIERS = Object.freeze(["FULL_FUNDING", "FUNDING_PLUS_REPAIR", "PREMIUM_STACK"]);
export const SUMMARY_NOT_OWED_TIERS = Object.freeze(["REPAIR_ONLY", "FRAUD_HOLD", "MANUAL_REVIEW"]);
/** "owed", "exempt", or "unknown" when the pull has no stored tier. Never guesses. */
export function summaryOwed(tier) {
  const t = String(tier == null ? "" : tier).trim().toUpperCase();
  if (SUMMARY_OWED_TIERS.includes(t)) return "owed";
  if (SUMMARY_NOT_OWED_TIERS.includes(t)) return "exempt";
  return "unknown";
}
/** The pack-ready email. Same key as src/slo/deliver.mjs SLO_PACK_EMAIL (a test pins it). */
export const PACK_EMAIL_TEMPLATE = "EMAIL-U02-ANALYZER-FUNDING-DELIVERY";
/**
 * The two places that save the pack AND queue the pack email in one breath:
 * src/slo/deliver.mjs (generatedBy "slo-pack") and src/sales/closer-deck.mjs
 * (generatedBy "closer-deck"). The CRS router (c-06) also saves a pack, and
 * sends no pack email, on purpose (the broad U-02 mail was retired 2026-08-22).
 * A test pins both literals to those two source files.
 */
export const PACK_EMAIL_PATHS = Object.freeze(["slo-pack", "closer-deck"]);
export const RECON =
  "Recon (AG-07) is the one tripwire. Read the rows. Do not auto-fix. Do not run a credit pull. Do not charge. Do not invent a second watchdog.";
export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}
export function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}
export function hasDb(db) {
  return Boolean(db && typeof db.query === "function");
}
export function cutoffIso(now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  return new Date(at.getTime() - GRACE_MS).toISOString();
}
export function num(row) {
  const n = Number(row && row.n);
  return Number.isFinite(n) ? n : 0;
}
export function sample(row) {
  const id = row && row.sample_id;
  return id ? ` Example client ${id}.` : "";
}
// A buyer who paid the roadmap ($297, link_ref slo_*), whose credit pull then
// finished (analysis.completed from the pull, after the payment, older than the
// grace), and who has none of the four pack files. "Paid" is the same test
// src/workflows/slo-genuine-followup.mjs uses: status paid OR a paid_at stamp.
// A buyer who has not filled the pull form yet has no pull, and is not here.
export const PAID_ROADMAP_SQL = `
SELECT count(DISTINCT c.id)::int AS n,
       min(c.id::text) AS sample_id
  FROM clients c
  JOIN payment_links pl
    ON pl.client_id = c.id
   AND pl.org_id = c.org_id
 WHERE COALESCE(c.is_demo, false) = false
   AND COALESCE(pl.is_demo, false) = false
   AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)
   AND pl.purpose = 'diagnostic'
   AND pl.link_ref LIKE 'slo_%'
   AND ($2::uuid IS NULL OR c.org_id = $2::uuid)
   AND EXISTS (
     SELECT 1
       FROM events e
      WHERE e.client_id = c.id
        AND e.org_id = c.org_id
        AND e.name = 'analysis.completed'
        AND e.payload->>'source' = 'crs'
        AND COALESCE(e.is_demo, false) = false
        AND e.created_at <= $1::timestamptz
        AND e.created_at >= COALESCE(pl.paid_at, pl.updated_at)
   )
   AND NOT EXISTS (
     SELECT 1
       FROM documents d
      WHERE d.client_id = c.id
        AND d.org_id = c.org_id
        AND d.kind = 'deliverable'
        AND d.subtype = ANY($3::text[])
   )`;
export async function checkPaidRoadmap(db, { orgId = null, now = new Date() } = {}) {
  const id = "uw-paid-roadmap-no-pack";
  if (!hasDb(db)) {
    return check(id, "skip", "no database in this run — paid roadmap packs not read");
  }
  try {
    const { rows } = await db.query(PAID_ROADMAP_SQL, [cutoffIso(now), orgId, PACK_SUBTYPES]);
    const row = rows[0] || {};
    const n = num(row);
    if (n === 0) {
      return check(id, "PASS", "no paid roadmap client with a finished pull is missing the UnderwriteIQ pack");
    }
    const word = n === 1 ? "client has" : "clients have";
    return check(
      id,
      "FAIL",
      `${n} paid roadmap ${word} a finished pull and no UnderwriteIQ pack.${sample(row)}`,
      "Open the paid roadmap client and see why the pack files were not saved. " + RECON
    );
  } catch (err) {
    return check(id, "FAIL", `could not read paid roadmap packs: ${clip(err && err.message)}`, RECON);
  }
}
// ── uw-pack-files-incomplete ─────────────────────────────────────────────────

// One row per real client that has any pack file. Facts only. No verdict here.
// "tier" is the credit tier of the newest pull saved at or before the pack's newest
// file: the pull the pack builder read when it made the pack (it reads the newest
// pull). A later pull must not change it. Stored tier on the pull, else the engine
// outcome stored in the pull. NULL when the pull has neither.
export const PACK_FILES_SQL = `
SELECT /* uw-pack-files */
       pk.client_id::text AS client_id,
       pk.subtypes,
       pk.first_at,
       pk.last_at,
       pk.empty_n,
       pk.short_n,
       pk.slo,
       t.tier AS tier
  FROM (
    SELECT d.client_id,
           d.org_id,
           array_agg(DISTINCT d.subtype) AS subtypes,
           min(d.created_at) AS first_at,
           max(d.created_at) AS last_at,
           count(*) FILTER (WHERE d.byte_size = 0)::int AS empty_n,
           count(*) FILTER (WHERE d.metadata->>'engine' = 'pdf-lib')::int AS short_n,
           bool_or(NULLIF(c.custom_fields->>'slo_ref', '') IS NOT NULL) AS slo
      FROM documents d
      JOIN clients c
        ON c.id = d.client_id
       AND c.org_id = d.org_id
     WHERE d.kind = 'deliverable'
       AND d.subtype = ANY($2::text[])
       AND COALESCE(d.is_demo, false) = false
       AND COALESCE(c.is_demo, false) = false
       AND ($1::uuid IS NULL OR d.org_id = $1::uuid)
     GROUP BY d.client_id, d.org_id
  ) pk
  LEFT JOIN LATERAL (
    SELECT COALESCE(NULLIF(r.outcome_tier, ''), NULLIF(r.result->>'outcome', '')) AS tier
      FROM crs_results r
     WHERE r.client_id = pk.client_id
       AND r.org_id = pk.org_id
       AND r.created_at <= pk.last_at
     ORDER BY r.created_at DESC
     LIMIT 1
  ) t ON true`;
export function ms(value) {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(t) ? t : null;
}
export function nameOf(subtype) {
  return PACK_FILE_NAMES[subtype] || subtype;
}
export function plural(n, one, many) {
  return n === 1 ? one : many;
}
export function shortId(id) {
  return String(id == null ? "" : id).slice(0, 8);
}
/**
 * Judge the pack rows. Pure. A pack still being saved (newest file under 30
 * minutes old) is not judged. A pack is NOT WHOLE when:
 *   - any of the files it is owed is missing. Four are always owed. The Capital
 *     Readiness Summary is owed only when the credit tier was a funding tier
 *     (see SUMMARY_OWED_TIERS). A repair or hold tier is not owed one, and a pull
 *     with no stored tier is "unsure": it is never called whole and never called
 *     broken on that file alone,
 *   - any pack file has 0 bytes (NULL size is unknown, so it is left alone),
 *   - any pack file was made by the short fallback printer (metadata engine pdf-lib),
 *   - a roadmap buyer's pack, first saved on or after MAP_OWED_FROM, has no map.
 * Returns { checked, bad, unsure, exempt }. unsure is the clients whose only gap
 * is a summary they may or may not be owed. exempt counts packs not owed one.
 */
export function judgePackFiles(rows, now = new Date()) {
  const cutoff = (now instanceof Date ? now : new Date(now)).getTime() - PACK_SETTLE_MS;
  const mapFrom = Date.parse(MAP_OWED_FROM);
  const bad = [];
  const unsure = [];
  let exempt = 0;
  let checked = 0;
  for (const row of rows || []) {
    const last = ms(row && row.last_at);
    if (last === null || last > cutoff) continue;
    checked += 1;
    const have = new Set(Array.isArray(row.subtypes) ? row.subtypes : []);
    const problems = [];
    let missing = PACK_REQUIRED_SUBTYPES.filter((s) => !have.has(s));
    let summaryUnsure = false;
    if (missing.includes("funding_summary")) {
      const owed = summaryOwed(row.tier);
      if (owed !== "owed") {
        missing = missing.filter((s) => s !== "funding_summary");
        if (owed === "exempt") exempt += 1;
        else summaryUnsure = true;
      }
    }
    if (missing.length) {
      problems.push(`is missing the ${missing.map(nameOf).join(", ")}`);
    }
    const empty = num({ n: row.empty_n });
    if (empty > 0) {
      problems.push(`has ${empty} pack ${plural(empty, "file", "files")} with 0 bytes`);
    }
    const short = num({ n: row.short_n });
    if (short > 0) {
      problems.push(`has ${short} pack ${plural(short, "file", "files")} made by the short fallback printer`);
    }
    const first = ms(row.first_at);
    if (row.slo === true && first !== null && first >= mapFrom && !have.has("business_duplication_map")) {
      problems.push(`is missing the ${nameOf("business_duplication_map")}, the free bonus`);
    }
    if (problems.length) bad.push({ clientId: row.client_id, problems });
    else if (summaryUnsure) unsure.push(row.client_id);
  }
  return { checked, bad, unsure, exempt };
}
export async function checkPackFiles(db, { orgId = null, now = new Date() } = {}) {
  const id = "uw-pack-files-incomplete";
  if (!hasDb(db)) {
    return check(id, "skip", "no database in this run — pack files not read");
  }
  let rows;
  try {
    ({ rows } = await db.query(PACK_FILES_SQL, [orgId, PACK_ANCHOR_SUBTYPES]));
  } catch (err) {
    return check(id, "skip", `could not read pack files: ${clip(err && err.message)}`);
  }
  const { checked, bad, unsure, exempt } = judgePackFiles(rows, now);
  if (bad.length === 0 && unsure.length === 0) {
    if (checked === 0) {
      return check(id, "PASS", "no pack has been saved for a real client yet, so none is half-built");
    }
    const note = exempt > 0
      ? ` (${exempt} on the repair or hold path ${plural(exempt, "is", "are")} not owed the Capital Readiness Summary)`
      : "";
    return check(
      id,
      "PASS",
      `all ${checked} saved ${plural(checked, "pack has", "packs have")} every promised file, none empty, none from the short printer${note}`
    );
  }
  const unsureWords =
    `${unsure.length} saved ${plural(unsure.length, "pack has", "packs have")} no Capital Readiness Summary and the credit pull behind ` +
    `${plural(unsure.length, "it", "them")} has no stored tier, so this run cannot say whether one is owed. Client ${shortId(unsure[0])}.`;
  if (bad.length === 0) {
    return check(id, "skip", unsureWords);
  }
  const examples = bad.slice(0, 3).map((b) => `Client ${shortId(b.clientId)} ${b.problems.join(" and ")}.`).join(" ");
  return check(
    id,
    "FAIL",
    `${bad.length} of ${checked} saved ${plural(checked, "pack is", "packs are")} not whole. ${examples}` +
      (unsure.length ? ` Also ${unsureWords.charAt(0).toLowerCase()}${unsureWords.slice(1)}` : ""),
    "Open the client's Documents and see which pack file did not save, then read the pack job for that client. Do not rebuild it from this pulse. " + RECON
  );
}
// ── uw-pack-email-not-queued ─────────────────────────────────────────────────

// One row per real client with any core pack file. Facts only. email_at is the
// newest pack-ready message queued for the client, whatever its status; failed
// and bounced mail is the email lane's job.
export const PACK_EMAIL_SQL = `
SELECT /* uw-pack-email */
       pk.client_id::text AS client_id,
       pk.core_n,
       pk.first_at,
       pk.last_at,
       COALESCE(pk.email_path, false) AS email_path,
       (NULLIF(c.custom_fields->>'slo_ref', '') IS NOT NULL) AS slo,
       (SELECT max(m.created_at)
          FROM messages m
         WHERE m.client_id = pk.client_id
           AND m.org_id = pk.org_id
           AND m.template_key = $4) AS email_at
  FROM (
    SELECT d.client_id,
           d.org_id,
           count(DISTINCT d.subtype)::int AS core_n,
           min(d.created_at) AS first_at,
           max(d.created_at) AS last_at,
           bool_or(d.generated_by = ANY($3::text[])) AS email_path
      FROM documents d
     WHERE d.kind = 'deliverable'
       AND d.subtype = ANY($2::text[])
       AND COALESCE(d.is_demo, false) = false
       AND ($1::uuid IS NULL OR d.org_id = $1::uuid)
     GROUP BY d.client_id, d.org_id
  ) pk
  JOIN clients c
    ON c.id = pk.client_id
   AND c.org_id = pk.org_id
 WHERE COALESCE(c.is_demo, false) = false`;
// Same read sendTemplated makes before it will queue anything.
export const PACK_TEMPLATE_SQL = `
SELECT body, subject, compliance_passed
  FROM message_templates
 WHERE org_id = $1::uuid
   AND template_key = $2
 LIMIT 1`;
/**
 * Judge the email rows. Pure. A buyer is OWED the pack-ready email when all four
 * core files are saved, the newest is over 30 minutes old, and the pack came
 * through a path that queues the email (an SLO roadmap buyer, or a pack saved by
 * "slo-pack" or "closer-deck"). They were TOLD when a pack-ready message was
 * queued at or after the first file. A pack saved only by the CRS router sends no
 * pack email by design, so it is never owed here.
 */
export function judgePackEmail(rows, now = new Date()) {
  const cutoff = (now instanceof Date ? now : new Date(now)).getTime() - PACK_SETTLE_MS;
  const notTold = [];
  let owed = 0;
  for (const row of rows || []) {
    if (num({ n: row && row.core_n }) < PACK_SUBTYPES.length) continue;
    if (!(row.slo === true || row.email_path === true)) continue;
    const last = ms(row.last_at);
    const first = ms(row.first_at);
    if (last === null || first === null || last > cutoff) continue;
    owed += 1;
    const told = ms(row.email_at);
    if (told === null || told < first) notTold.push(row.client_id);
  }
  return { owed, notTold };
}
/** Why the pack email could never be queued, or null when the template is ready. */
export function judgePackTemplate(row) {
  if (!row) return `${PACK_EMAIL_TEMPLATE} has no row, so no pack-ready email can be queued`;
  if (isDraftTemplateRow(row)) return `${PACK_EMAIL_TEMPLATE} still holds draft copy, so it is refused`;
  if (!row.compliance_passed) return `${PACK_EMAIL_TEMPLATE} is not approved, so it is refused`;
  return null;
}
export const EMAIL_FIX =
  "Read the client's messages for " + PACK_EMAIL_TEMPLATE + " and the slo-pack-delivery run. " +
  "If the template is missing or not approved, fix it in the template editor. Do not send from this pulse. " + RECON;
export async function checkPackEmail(db, { orgId = null, now = new Date() } = {}) {
  const id = "uw-pack-email-not-queued";
  if (!hasDb(db)) {
    return check(id, "skip", "no database in this run — pack email not read");
  }
  let rows = null;
  let factsErr = null;
  try {
    ({ rows } = await db.query(PACK_EMAIL_SQL, [orgId, PACK_SUBTYPES, PACK_EMAIL_PATHS, PACK_EMAIL_TEMPLATE]));
  } catch (err) {
    factsErr = clip(err && err.message);
  }
  let templateWhy = null;
  let templateErr = null;
  let templateRead = false;
  if (orgId) {
    try {
      const out = await db.query(PACK_TEMPLATE_SQL, [orgId, PACK_EMAIL_TEMPLATE]);
      templateWhy = judgePackTemplate(out.rows && out.rows[0]);
      templateRead = true;
    } catch (err) {
      templateErr = clip(err && err.message);
    }
  }
  const verdict = rows ? judgePackEmail(rows, now) : { owed: 0, notTold: [] };
  const reds = [];
  if (verdict.notTold.length) {
    const n = verdict.notTold.length;
    reds.push(
      `${n} ${plural(n, "buyer has", "buyers have")} a saved pack older than 30 minutes and no pack-ready email was queued. ` +
      `Client ${shortId(verdict.notTold[0])}.`
    );
  }
  if (templateWhy) reds.push(`${templateWhy}.`);
  if (reds.length) return check(id, "FAIL", reds.join(" "), EMAIL_FIX);
  if (factsErr) return check(id, "skip", `could not read pack emails: ${factsErr}`);
  if (!orgId) return check(id, "skip", "no company id in this run — pack email template not read");
  if (templateErr) return check(id, "skip", `could not read the pack email template: ${templateErr}`);
  if (!templateRead) return check(id, "skip", "pack email template not read");
  return check(
    id,
    "PASS",
    verdict.owed === 0
      ? "the pack email template is approved, and no buyer is waiting on a pack-ready email"
      : `the pack email template is approved, and all ${verdict.owed} ${plural(verdict.owed, "buyer", "buyers")} owed the pack email ${plural(verdict.owed, "has", "have")} one queued`
  );
}
