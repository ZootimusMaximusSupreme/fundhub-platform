// Business info for a business container (Finance OS Accounts page,
// /app/money-accounts.html).
//
// Chris, 2026-10-06: "add a business and input all relevant business
// information… containers within the business structure."
//
// WHERE IT LIVES — NO NEW TABLE, NO MIGRATION. A container is an `entities` row
// (106). Company facts already have a home: the `businesses` table (001_init),
// whose `entity_data` jsonb is what UnderwriteIQ, lender match and the closer
// deck read (entity_data.state, entity_data.incorporated_date, age_months,
// name). So a business container's info is ONE `businesses` row, tied back to
// its container by entity_data.entity_id and marked entity_data.source =
// 'finance_os'. 106's header said a later change could link the two "once
// someone decides that's wanted" — Chris decided.
//
// WHY ITS OWN SOURCE. The $297 pull form (src/slo/businesses.mjs, source 'slo')
// and the staff approve form (api/soft-pull-approve.mjs, 'soft_pull_approve')
// each DELETE and re-insert their own rows. A Finance OS row carries its own
// source so neither form ever erases it, and this module never touches theirs.
//
// NEVER A FULL EIN. Only the last 4 digits are accepted and stored
// (entity_data.ein_last4). More than 4 digits is refused, not trimmed, so the
// person learns we did not keep it. No SSN field exists here at all.
//
// ONE ROW PER CONTAINER. The save locks the container row (FOR UPDATE) inside a
// transaction, then updates the row it finds or inserts one. Two saves at once
// wait for each other instead of making two rows.
//
// NO DELETES. Nothing here removes a row.

import { withTransaction } from "../db/with-transaction.mjs";
import { parseIncorporatedDate, ageMonthsFromIncorporated, businessPhone } from "../slo/businesses.mjs";
import { US_STATES } from "../slo/fields.mjs";

export const FINANCE_OS_BUSINESS_SOURCE = "finance_os";

export const ENTITY_TYPES = Object.freeze(["llc", "s_corp", "c_corp", "sole_prop", "partnership", "nonprofit", "other"]);

/** The keys this module writes into entity_data, and nothing else. */
export const INFO_FIELDS = Object.freeze([
  "legal_name", "dba", "ein_last4", "entity_type", "formation_state", "started",
  "industry", "address_line1", "city", "state", "postal_code", "phone", "website"
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

function text(v, field, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > max) throw new TypeError(`${field} must be ${max} characters or fewer`);
  return s;
}

function stateCode(v, field) {
  const s = text(v, field, 2 + 10);
  if (s === null) return null;
  const up = s.toUpperCase();
  if (!US_STATES.includes(up)) throw new TypeError(`${field} must be a 2-letter US state, like AZ`);
  return up;
}

/**
 * readBusinessInfo(input, { now }) → { legal_name, ..., age_months }
 *
 * Every field is optional. A blank field is null (unknown), never a guess.
 * Throws TypeError with a plain sentence on anything that cannot be stored.
 */
export function readBusinessInfo(input = {}, { now = new Date() } = {}) {
  const src = input && typeof input === "object" ? input : {};

  for (const k of ["ein", "full_ein", "tax_id", "ssn", "social"]) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      throw new TypeError("EIN: send the last 4 digits only (ein_last4). We never store a full EIN or a Social Security number");
    }
  }

  let einLast4 = null;
  if (src.ein_last4 !== null && src.ein_last4 !== undefined && String(src.ein_last4).trim() !== "") {
    const digits = String(src.ein_last4).replace(/\D/g, "");
    if (digits.length > 4) {
      throw new TypeError("EIN: last 4 digits only. We never store a full EIN. Nothing was saved");
    }
    if (digits.length !== 4 || /[^\d\s•*-]/.test(String(src.ein_last4))) {
      throw new TypeError("EIN last 4 must be exactly 4 digits");
    }
    einLast4 = digits;
  }

  let entityType = null;
  if (src.entity_type !== null && src.entity_type !== undefined && String(src.entity_type).trim() !== "") {
    const t = String(src.entity_type).trim().toLowerCase();
    if (!ENTITY_TYPES.includes(t)) throw new TypeError(`entity_type must be one of ${ENTITY_TYPES.join(", ")}`);
    entityType = t;
  }

  let started = null;
  let ageMonths = null;
  if (src.started !== null && src.started !== undefined && String(src.started).trim() !== "") {
    started = parseIncorporatedDate(src.started);
    if (!started) throw new TypeError("started must be a date like 2021-03 or 2021-03-15");
    ageMonths = ageMonthsFromIncorporated(started, now);
    if (ageMonths === null) throw new TypeError("started is in the future. Please check it");
  }

  let phone = null;
  if (src.phone !== null && src.phone !== undefined && String(src.phone).trim() !== "") {
    phone = businessPhone(src.phone);
    if (!phone) throw new TypeError("phone must be a 10-digit US phone number");
  }

  let postal = null;
  if (src.postal_code !== null && src.postal_code !== undefined && String(src.postal_code).trim() !== "") {
    const z = String(src.postal_code).trim();
    if (!/^\d{5}(-\d{4})?$/.test(z)) throw new TypeError("postal_code must be a 5-digit ZIP, like 85004");
    postal = z;
  }

  let website = text(src.website, "website", 200);
  if (website !== null) {
    if (/\s/.test(website) || !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(website)) {
      throw new TypeError("website must look like example.com or https://example.com");
    }
    website = website.toLowerCase().startsWith("http") ? website : `https://${website}`;
  }

  return {
    legal_name: text(src.legal_name, "legal_name", 120),
    dba: text(src.dba, "dba", 120),
    ein_last4: einLast4,
    entity_type: entityType,
    formation_state: stateCode(src.formation_state, "formation_state"),
    started,
    industry: text(src.industry, "industry", 100),
    address_line1: text(src.address_line1, "address_line1", 120),
    city: text(src.city, "city", 80),
    state: stateCode(src.state, "state"),
    postal_code: postal,
    phone,
    website,
    age_months: ageMonths
  };
}

/** A stored businesses row → the info shape a screen shows. Never an EIN beyond last 4. */
export function infoView(row) {
  if (!row) return null;
  const e = row.entity_data && typeof row.entity_data === "object" ? row.entity_data : {};
  const out = { business_id: row.id };
  for (const k of INFO_FIELDS) out[k] = e[k] ?? null;
  /* The legal name is businesses.name — the column every reader uses. */
  out.legal_name = row.name ?? e.legal_name ?? null;
  /* incorporated_date is the key the other readers use; started mirrors it. */
  out.started = e.incorporated_date ?? e.started ?? null;
  out.age_months = row.age_months ?? null;
  return out;
}

/** listBusinessInfo(db, { orgId, clientId }) → Map(containerId → info) */
export async function listBusinessInfo(db, { orgId, clientId }) {
  if (!orgId) throw new TypeError("orgId is required");
  if (!isUuid(clientId)) throw new TypeError("client_id must be a uuid");
  const rows = (await db.query(
    `SELECT id, name, age_months, entity_data, updated_at
       FROM businesses
      WHERE org_id = $1 AND client_id = $2
        AND entity_data->>'source' = $3
        AND entity_data ? 'entity_id'
      ORDER BY updated_at DESC, id`,
    [orgId, String(clientId).trim(), FINANCE_OS_BUSINESS_SOURCE]
  )).rows;
  const map = new Map();
  for (const r of rows) {
    const eid = r.entity_data && r.entity_data.entity_id;
    if (eid && !map.has(String(eid))) map.set(String(eid), infoView(r));
  }
  return map;
}

/**
 * saveBusinessInfo(db, { orgId, clientId, containerId, info, fallbackName? })
 *   → { ok: true, business_id, created } | { ok: false, reason }
 *
 * `info` is the output of readBusinessInfo. The container must be a business
 * container of this client in this org and not archived.
 */
export async function saveBusinessInfo(db, { orgId, clientId, containerId, info, fallbackName = null }) {
  if (!orgId) throw new TypeError("orgId is required");
  if (!isUuid(clientId)) throw new TypeError("client_id must be a uuid");
  if (!isUuid(containerId)) throw new TypeError("container_id must be a uuid");
  const cid = String(clientId).trim();
  const eid = String(containerId).trim();
  const i = info || {};

  return withTransaction(db, async (tx) => {
    const ent = (await tx.query(
      `SELECT id, client_id, kind, name, archived_at
         FROM entities WHERE id = $1 AND org_id = $2 AND client_id = $3
        FOR UPDATE`,
      [eid, orgId, cid]
    )).rows[0];
    if (!ent) return { ok: false, reason: "container_not_found" };
    if (ent.kind !== "business") return { ok: false, reason: "not_a_business_container" };
    if (ent.archived_at) return { ok: false, reason: "container_archived" };

    /* businesses.name is the company name every reader uses. The legal name
       when given; otherwise the name the person gave this business. */
    const name = i.legal_name || fallbackName || ent.name || null;
    const data = {
      source: FINANCE_OS_BUSINESS_SOURCE,
      entity_id: eid,
      dba: i.dba ?? null,
      ein_last4: i.ein_last4 ?? null,
      entity_type: i.entity_type ?? null,
      formation_state: i.formation_state ?? null,
      incorporated_date: i.started ?? null,
      industry: i.industry ?? null,
      address_line1: i.address_line1 ?? null,
      city: i.city ?? null,
      state: i.state ?? null,
      postal_code: i.postal_code ?? null,
      phone: i.phone ?? null,
      website: i.website ?? null
    };

    const found = (await tx.query(
      `SELECT id FROM businesses
        WHERE org_id = $1 AND client_id = $2
          AND entity_data->>'source' = $3 AND entity_data->>'entity_id' = $4
        ORDER BY updated_at DESC, id
        LIMIT 1`,
      [orgId, cid, FINANCE_OS_BUSINESS_SOURCE, eid]
    )).rows[0];

    if (found) {
      await tx.query(
        `UPDATE businesses
            SET name = $4, age_months = $5, entity_data = $6::jsonb, updated_at = now()
          WHERE id = $1 AND org_id = $2 AND client_id = $3`,
        [found.id, orgId, cid, name, i.age_months ?? null, JSON.stringify(data)]
      );
      return { ok: true, business_id: found.id, created: false };
    }
    const ins = (await tx.query(
      `INSERT INTO businesses (org_id, client_id, name, age_months, entity_data)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [orgId, cid, name, i.age_months ?? null, JSON.stringify(data)]
    )).rows[0];
    return { ok: true, business_id: ins.id, created: true };
  });
}
