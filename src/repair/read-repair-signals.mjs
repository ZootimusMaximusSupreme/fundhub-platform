/* Repair desk — THE READ LAYER for src/repair/lens.mjs.
 *
 * READ ONLY. SELECT only. No money columns from repair_programs (§2.11 / §9).
 * Spec: ops/workflows/repair-build-spec-2026-08-21.md §8–§9.
 *
 * The API ships facts; lens.mjs draws conclusions. Same split as
 * src/fulfillment/read-signals.mjs.
 */

import { CONSENT_VALID_SQL } from "../consent/index.mjs";
import { isBreached } from "./sla.mjs";
import { timelineLine } from "./lens.mjs";

export const DISPUTE_AUTH_KIND = "dispute_authorization";

function idList(clientIds) {
  const seen = new Set();
  for (const id of Array.isArray(clientIds) ? clientIds : []) {
    if (typeof id === "string" && id.trim() !== "") seen.add(id.trim());
  }
  return [...seen];
}

function byClient(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = r && r.client_id != null ? String(r.client_id) : null;
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return out;
}

async function safeRows(db, sql, params, label) {
  try {
    const r = await db.query(sql, params);
    return r && Array.isArray(r.rows) ? r.rows : [];
  } catch (err) {
    console.warn(`[repair] signal read failed (${label}):`, err && err.message);
    return null;
  }
}

/* program / rounds_cap / status ONLY — never price_total or amount_paid (§2.11). */
const PROGRAMS_SQL = `
  SELECT client_id, program, rounds_cap, status
    FROM repair_programs
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])`;

function authSql() {
  return `
    SELECT DISTINCT ON (client_id)
           client_id,
           (${CONSENT_VALID_SQL}) AS is_valid
      FROM client_consents
     WHERE org_id = $1::uuid
       AND client_id = ANY($2::uuid[])
       AND kind = $3
     ORDER BY client_id, (${CONSENT_VALID_SQL}) DESC, granted_at DESC, id DESC`;
}

/* address_ok: first pii_identity address has a street line. */
const ADDRESS_SQL = `
  SELECT client_id,
         (
           addresses IS NOT NULL
           AND jsonb_typeof(addresses) = 'array'
           AND jsonb_array_length(addresses) > 0
           AND NULLIF(TRIM(COALESCE(
                 addresses->0->>'address_line1',
                 addresses->0->>'addressLine1',
                 addresses->0->>'line1',
                 addresses->0->>'street',
                 ''
               )), '') IS NOT NULL
         ) AS address_ok
    FROM pii_identity
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])`;

/* Company street on businesses.entity_data — same keys the soft-pull form saves. */
const COMPANY_ADDRESS_SQL = `
  SELECT DISTINCT client_id
    FROM businesses
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND NULLIF(TRIM(COALESCE(
           entity_data->>'address_line1',
           entity_data->>'addressLine1',
           entity_data->>'street',
           entity_data->>'line1',
           ''
         )), '') IS NOT NULL`;

/* Signed repair paper counts as agreement on the desk, same as generate. */
const SIGNED_REPAIR_SQL = `
  SELECT DISTINCT c.client_id
    FROM contracts c
    LEFT JOIN contract_templates t
      ON t.org_id = c.org_id AND t.template_key = c.template_key
   WHERE c.org_id = $1::uuid
     AND c.client_id = ANY($2::uuid[])
     AND c.status = 'signed'
     AND (
       t.subtype = 'credit_repair'
       OR c.template_key ILIKE '%REPAIR%'
     )`;

const DUE_SQL = `
  SELECT client_id, MIN(response_due_at) AS response_due_at
    FROM dispute_cases
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND status NOT IN ('closed', 'cancelled')
     AND response_due_at IS NOT NULL
   GROUP BY client_id`;

const UNCONFIRMED_SQL = `
  SELECT client_id, COUNT(*)::int AS n
    FROM dispute_responses
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND confirmed = false
   GROUP BY client_id`;

const TIMELINE_SQL = `
  SELECT created_at AS ts, decision AS action, payload
    FROM repair_decision_log
   WHERE org_id = $1::uuid
     AND client_id = $2::uuid
   ORDER BY created_at DESC
   LIMIT 40`;

const SIGNER_SQL = `
  SELECT c.signer_name, c.signed_at
    FROM contracts c
    LEFT JOIN contract_templates t
      ON t.org_id = c.org_id AND t.template_key = c.template_key
   WHERE c.org_id = $1::uuid
     AND c.client_id = $2::uuid
     AND c.status = 'signed'
     AND (
       t.subtype = 'credit_repair'
       OR c.template_key ILIKE '%REPAIR%'
     )
   ORDER BY c.signed_at DESC NULLS LAST
   LIMIT 1`;

/**
 * gatherRepairSignals — §9 list facts for a page of repair clients.
 * Returns Map clientId → signal object. Missing table → that signal stays off.
 *
 * @param {object} db
 * @param {{ orgId: string, clientIds: string[], files?: object[] }} opts
 *   `files` (optional) carry stage_key / entered_at / response_due_at for SLA.
 */
export async function gatherRepairSignals(db, { orgId, clientIds, files = [] } = {}) {
  const ids = idList(clientIds);
  const out = new Map();
  if (!orgId || ids.length === 0) return out;

  const args = [orgId, ids];
  const [programRows, authRows, addressRows, companyAddrRows, signedRows, dueRows, unconfRows] = await Promise.all([
    safeRows(db, PROGRAMS_SQL, args, "repair_programs"),
    safeRows(db, authSql(), [orgId, ids, DISPUTE_AUTH_KIND], "client_consents"),
    safeRows(db, ADDRESS_SQL, args, "pii_identity"),
    safeRows(db, COMPANY_ADDRESS_SQL, args, "businesses.address"),
    safeRows(db, SIGNED_REPAIR_SQL, args, "contracts.repair"),
    safeRows(db, DUE_SQL, args, "dispute_cases.due"),
    safeRows(db, UNCONFIRMED_SQL, args, "dispute_responses")
  ]);

  const programBy = byClient(programRows);
  const authBy = byClient(authRows);
  const addressBy = byClient(addressRows);
  const companyAddrBy = byClient(companyAddrRows);
  const signedBy = byClient(signedRows);
  const dueBy = byClient(dueRows);
  const unconfBy = byClient(unconfRows);

  const fileBy = new Map();
  for (const f of Array.isArray(files) ? files : []) {
    if (f && f.client_id) fileBy.set(String(f.client_id), f);
  }

  for (const id of ids) {
    const signals = {};
    const file = fileBy.get(id) || {};

    if (programRows !== null) {
      const p = (programBy.get(id) || [])[0];
      if (p) {
        signals.program = p.program || null;
        signals.rounds_cap = p.rounds_cap == null ? null : Number(p.rounds_cap);
        signals.program_status = p.status || null;
        signals.upsell_pending = String(p.status || "") === "upsell_pending";
      } else {
        signals.program = null;
        signals.rounds_cap = null;
        signals.program_status = null;
        signals.upsell_pending = false;
      }
    }

    if (authRows !== null) {
      const row = (authBy.get(id) || [])[0];
      signals.authorization_ok = Boolean(row && row.is_valid === true);
    }
    /* AUTHORIZED MEANS A SIGNED PAPER, NOTHING ELSE. A live dispute_authorization
       consent (the portal's signing box) or a signed repair agreement. An
       enrolled program is NOT a signature. It used to count as one here, which
       hid the "Needs agreement" chip on a paid client who had signed nothing,
       while the letter writer (src/repair/analyze.mjs) refused him with
       `no_authorization`. Desk and writer now read the same two papers. */
    if (signals.authorization_ok !== true && signedRows !== null) {
      signals.authorization_ok = (signedBy.get(id) || []).length > 0;
    }

    if (addressRows !== null || companyAddrRows !== null) {
      const row = (addressBy.get(id) || [])[0];
      const piiOk = row ? row.address_ok === true : false;
      const companyOk = (companyAddrBy.get(id) || []).length > 0;
      signals.address_ok = piiOk || companyOk;
    }

    if (dueRows !== null) {
      const row = (dueBy.get(id) || [])[0];
      signals.response_due_at = row && row.response_due_at ? row.response_due_at : null;
    }

    if (unconfRows !== null) {
      const row = (unconfBy.get(id) || [])[0];
      signals.has_unconfirmed_parse = Boolean(row && Number(row.n) > 0);
    }

    const dueAt = signals.response_due_at != null
      ? signals.response_due_at
      : (file.response_due_at || null);
    const breach = isBreached({
      stageKey: file.stage_key,
      enteredAt: file.entered_at || file.updated_at,
      responseDueAt: dueAt
    });
    signals.sla_breached = Boolean(breach && breach.breached);

    out.set(id, signals);
  }

  return out;
}

/**
 * gatherRepairDetailSignals — timeline + signature for one client detail.
 */
export async function gatherRepairDetailSignals(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return {};
  const out = {};

  const [timelineRows, signerRows] = await Promise.all([
    safeRows(db, TIMELINE_SQL, [orgId, clientId], "repair_decision_log"),
    safeRows(db, SIGNER_SQL, [orgId, clientId], "contracts.signer")
  ]);

  if (timelineRows !== null) {
    out.timeline = timelineRows.map((row) => ({
      ts: row.ts || null,
      action: row.action || null,
      words: timelineLine(row)
    }));
  }

  if (signerRows !== null) {
    const s = signerRows[0];
    out.signer_name = s && s.signer_name ? String(s.signer_name) : null;
    out.signed_at = s && s.signed_at ? s.signed_at : null;
  }

  return out;
}
