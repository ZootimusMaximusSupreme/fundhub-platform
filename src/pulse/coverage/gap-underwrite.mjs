// UnderwriteIQ, SLO pack, and offer fulfillment — morning gap checks.
// Report only. Never auto-fix. Never pull credit. Never charge.
//
// Slice 19 lists SLO workflow names. Slice 21 lists the underwrite door and
// the CRS jobs. This file does not repeat those lists. It reads whether a
// paid roadmap client has no pack, whether letters that should be on file
// are missing, whether the pack job failed, and whether the read door
// answers 500.
//
// Tripwire is Recon (AG-07) on the morning pulse. Do not invent a second watchdog.

export const GRACE_MS = 2 * 60 * 60 * 1000;

/** The four files every funding pack stores. A bonus file is not the pack. */
export const PACK_SUBTYPES = Object.freeze([
  "credit_analysis_report",
  "credit_optimization_roadmap",
  "funding_snapshot",
  "bank_lender_match_list"
]);

/** What deliverSloPack writes when the pack does not land. */
export const SLO_PACK_FAILED = "Delivery Failed — Retry";

/** In-process handlers that build the pack. Named in failed_events.handler_name. */
export const PACK_HANDLERS = Object.freeze([
  "onAnalysisCompletedDeliverables",
  "onAnalysisCompletedSloPack"
]);

const RECON =
  "Recon (AG-07) is the one tripwire. Read the rows. Do not auto-fix. Do not run a credit pull. Do not charge. Do not invent a second watchdog.";

const DOOR_FIX =
  "Fix GET /api/read/underwrite so staff can open it. Do not change UnderwriteIQ dollar math. " +
  RECON;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function hasDb(db) {
  return Boolean(db && typeof db.query === "function");
}

function cutoffIso(now) {
  const at = now instanceof Date ? now : new Date(now || Date.now());
  return new Date(at.getTime() - GRACE_MS).toISOString();
}

function num(row) {
  const n = Number(row && row.n);
  return Number.isFinite(n) ? n : 0;
}

function sample(row) {
  const id = row && row.sample_id;
  return id ? ` Example client ${id}.` : "";
}

export const PAID_ROADMAP_SQL = `
SELECT count(*)::int AS n,
       min(c.id::text) AS sample_id
  FROM clients c
  JOIN payment_links pl
    ON pl.client_id = c.id
   AND pl.org_id = c.org_id
 WHERE c.is_demo = false
   AND pl.is_demo = false
   AND pl.status = 'paid'
   AND pl.purpose = 'diagnostic'
   AND pl.link_ref LIKE 'slo_%'
   AND COALESCE(pl.paid_at, pl.updated_at) <= $1::timestamptz
   AND ($2::uuid IS NULL OR c.org_id = $2::uuid)
   AND NOT EXISTS (
     SELECT 1
       FROM documents d
      WHERE d.client_id = c.id
        AND d.org_id = c.org_id
        AND d.kind = 'deliverable'
        AND d.subtype = ANY($3::text[])
   )`;

export const LETTERS_SQL = `
SELECT count(*)::int AS n,
       min(c.id::text) AS sample_id
  FROM clients c
 WHERE c.is_demo = false
   AND ($2::uuid IS NULL OR c.org_id = $2::uuid)
   AND EXISTS (
     SELECT 1
       FROM events e
      WHERE e.client_id = c.id
        AND e.org_id = c.org_id
        AND e.name = 'analysis.completed'
        AND e.payload->>'source' = 'crs'
        AND e.is_demo = false
        AND e.created_at <= $1::timestamptz
   )
   AND (
     (
       (
         CASE WHEN COALESCE(c.custom_fields->>'crs_inquiries_ex', '') ~ '^[0-9]+$'
              THEN (c.custom_fields->>'crs_inquiries_ex')::int ELSE 0 END
         + CASE WHEN COALESCE(c.custom_fields->>'crs_inquiries_eq', '') ~ '^[0-9]+$'
              THEN (c.custom_fields->>'crs_inquiries_eq')::int ELSE 0 END
         + CASE WHEN COALESCE(c.custom_fields->>'crs_inquiries_tu', '') ~ '^[0-9]+$'
              THEN (c.custom_fields->>'crs_inquiries_tu')::int ELSE 0 END
       ) > 0
       AND NOT EXISTS (
         SELECT 1
           FROM documents d
          WHERE d.client_id = c.id
            AND d.org_id = c.org_id
            AND d.kind = 'deliverable'
            AND d.subtype = 'funding_inquiry_removal'
       )
     )
     OR
     (
       CASE WHEN COALESCE(c.custom_fields->>'crs_negative_items_count', '') ~ '^[0-9]+$'
            THEN (c.custom_fields->>'crs_negative_items_count')::int ELSE 0 END > 0
       AND EXISTS (
         SELECT 1
           FROM dispute_cases dc
          WHERE dc.client_id = c.id
            AND dc.org_id = c.org_id
            AND dc.status <> 'cancelled'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM dispute_letters dl
          WHERE dl.client_id = c.id
            AND dl.org_id = c.org_id
       )
     )
   )`;

export const OFFER_DEAD_LETTER_SQL = `
SELECT count(*)::int AS n,
       (array_agg(handler_name ORDER BY last_seen_at DESC))[1] AS handler_name,
       left((array_agg(error_message ORDER BY last_seen_at DESC))[1], 160) AS error_message
  FROM failed_events
 WHERE status IN ('pending', 'exhausted')
   AND handler_name = ANY($1::text[])
   AND ($2::uuid IS NULL OR org_id = $2::uuid)`;

export const OFFER_PACK_STATUS_SQL = `
SELECT count(*)::int AS n,
       min(id::text) AS sample_id
  FROM clients
 WHERE is_demo = false
   AND custom_fields->>'slo_pack_status' = $1
   AND ($2::uuid IS NULL OR org_id = $2::uuid)`;

async function checkPaidRoadmap(db, { orgId = null, now = new Date() } = {}) {
  const id = "uw-paid-roadmap-no-pack";
  if (!hasDb(db)) {
    return check(id, "skip", "no database in this run — paid roadmap packs not read");
  }
  try {
    const { rows } = await db.query(PAID_ROADMAP_SQL, [cutoffIso(now), orgId, PACK_SUBTYPES]);
    const row = rows[0] || {};
    const n = num(row);
    if (n === 0) {
      return check(id, "PASS", "no paid roadmap client is missing the UnderwriteIQ pack");
    }
    const word = n === 1 ? "client has" : "clients have";
    return check(
      id,
      "FAIL",
      `${n} paid roadmap ${word} no UnderwriteIQ pack.${sample(row)}`,
      "Open the paid roadmap client and see why the pack files were not saved. " + RECON
    );
  } catch (err) {
    return check(id, "FAIL", `could not read paid roadmap packs: ${clip(err && err.message)}`, RECON);
  }
}

async function checkLetters(db, { orgId = null, now = new Date() } = {}) {
  const id = "uw-letters-missing";
  if (!hasDb(db)) {
    return check(id, "skip", "no database in this run — letters not read");
  }
  try {
    const { rows } = await db.query(LETTERS_SQL, [cutoffIso(now), orgId]);
    const row = rows[0] || {};
    const n = num(row);
    if (n === 0) {
      return check(id, "PASS", "no client with inquiries or an open dispute case is missing letters");
    }
    const word = n === 1 ? "client is" : "clients are";
    return check(
      id,
      "FAIL",
      `${n} ${word} missing letters that should be on file.${sample(row)}`,
      "Read the credit file and the letter rows. Do not change UnderwriteIQ dollar math. " + RECON
    );
  } catch (err) {
    return check(id, "FAIL", `could not read letter rows: ${clip(err && err.message)}`, RECON);
  }
}

async function checkOfferFulfillment(db, { orgId = null } = {}) {
  const id = "uw-offer-fulfillment-failed";
  if (!hasDb(db)) {
    return check(id, "skip", "no database in this run — offer fulfillment not read");
  }
  try {
    const dead = await db.query(OFFER_DEAD_LETTER_SQL, [PACK_HANDLERS, orgId]);
    const stamped = await db.query(OFFER_PACK_STATUS_SQL, [SLO_PACK_FAILED, orgId]);
    const deadRow = (dead.rows && dead.rows[0]) || {};
    const stampRow = (stamped.rows && stamped.rows[0]) || {};
    const deadN = num(deadRow);
    const stampN = num(stampRow);
    if (deadN === 0 && stampN === 0) {
      return check(id, "PASS", "offer fulfillment has no open failure");
    }
    const parts = [];
    if (deadN > 0) {
      const who = deadRow.handler_name ? ` (${deadRow.handler_name})` : "";
      const why = deadRow.error_message ? `: ${clip(deadRow.error_message, 120)}` : "";
      parts.push(`${deadN} pack job failure${deadN === 1 ? "" : "s"}${who}${why}`);
    }
    if (stampN > 0) {
      parts.push(`${stampN} client pack status is ${SLO_PACK_FAILED}.${sample(stampRow)}`);
    }
    return check(
      id,
      "FAIL",
      parts.join(" "),
      "Read the failed pack job. Do not re-run it from this pulse. " + RECON
    );
  } catch (err) {
    return check(id, "FAIL", `could not read offer fulfillment: ${clip(err && err.message)}`, RECON);
  }
}

export async function checkReadDoor({ fetchImpl, baseUrl = "https://fundhub.ai" } = {}) {
  const id = "uw-read-door";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch in this run — underwrite read door not opened");
  }
  const root = String(baseUrl || "https://fundhub.ai").replace(/\/$/, "");
  const url = `${root}/api/read/underwrite`;
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
    const status = Number(res && res.status);
    if (status >= 500) {
      let text = "";
      try {
        text = typeof res.text === "function" ? await res.text() : "";
      } catch {
        text = "";
      }
      const extra = text ? `: ${clip(text)}` : "";
      return check(id, "FAIL", `underwrite read door answered ${status}${extra}`, DOOR_FIX);
    }
    if (status === 401 || status === 403 || (status >= 200 && status < 300)) {
      return check(id, "PASS", `underwrite read door answered ${status}`);
    }
    return check(id, "FAIL", `underwrite read door answered ${status}`, DOOR_FIX);
  } catch (err) {
    return check(
      id,
      "FAIL",
      `underwrite read door unreachable: ${clip(err && err.message)}`,
      DOOR_FIX
    );
  }
}

/**
 * @param {{ db?: { query: Function }, orgId?: string|null, now?: Date|string|number, fetchImpl?: Function, baseUrl?: string }} [ctx]
 * @returns {Promise<Array<{ id: string, status: string, detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const scope = { orgId, now };
  return [
    await checkPaidRoadmap(db, scope),
    await checkLetters(db, scope),
    await checkOfferFulfillment(db, scope),
    await checkReadDoor({ fetchImpl: ctx.fetchImpl, baseUrl: ctx.baseUrl })
  ];
}
