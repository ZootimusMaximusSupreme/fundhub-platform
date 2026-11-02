// proxy_sessions store — audit trail for Oxylabs Apply launches.

export class ProxySessionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ProxySessionError";
    this.code = code;
    this.status = status;
  }
}

export async function insertProxySession(db, row) {
  const r = await db.query(
    `INSERT INTO proxy_sessions (
       org_id, client_id, staff_id, lender_id, application_id,
       requested_city, requested_state, granted_city, granted_region,
       targeting_level, exit_ip, sessid, proxy_username, application_url,
       status, error_code, error_message, verification, ended_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       $6, $7, $8, $9,
       $10, $11, $12, $13, $14,
       $15, $16, $17, $18::jsonb, $19::timestamptz
     )
     RETURNING *`,
    [
      row.orgId,
      row.clientId,
      row.staffId,
      row.lenderId || null,
      row.applicationId || null,
      row.requestedCity || null,
      row.requestedState || null,
      row.grantedCity || null,
      row.grantedRegion || null,
      row.targetingLevel || null,
      row.exitIp || null,
      row.sessid,
      row.proxyUsername || null,
      row.applicationUrl || null,
      row.status || "verifying",
      row.errorCode || null,
      row.errorMessage || null,
      JSON.stringify(row.verification || {}),
      row.endedAt || null
    ]
  );
  return r.rows[0];
}

export async function updateProxySession(db, { orgId, id, patch }) {
  const r = await db.query(
    `UPDATE proxy_sessions SET
       granted_city     = COALESCE($3, granted_city),
       granted_region   = COALESCE($4, granted_region),
       targeting_level  = COALESCE($5, targeting_level),
       exit_ip          = COALESCE($6, exit_ip),
       proxy_username   = COALESCE($7, proxy_username),
       status           = COALESCE($8, status),
       error_code       = COALESCE($9, error_code),
       error_message    = COALESCE($10, error_message),
       verification     = COALESCE($11::jsonb, verification),
       ended_at         = COALESCE($12::timestamptz, ended_at)
     WHERE org_id = $1::uuid AND id = $2::uuid
     RETURNING *`,
    [
      orgId,
      id,
      patch.grantedCity ?? null,
      patch.grantedRegion ?? null,
      patch.targetingLevel ?? null,
      patch.exitIp ?? null,
      patch.proxyUsername ?? null,
      patch.status ?? null,
      patch.errorCode ?? null,
      patch.errorMessage ?? null,
      patch.verification != null ? JSON.stringify(patch.verification) : null,
      patch.endedAt ?? null
    ]
  );
  return r.rows[0] || null;
}

export async function endProxySession(db, { orgId, id, staffId = null }) {
  const r = await db.query(
    `UPDATE proxy_sessions SET
       status = 'ended',
       ended_at = now()
     WHERE org_id = $1::uuid
       AND id = $2::uuid
       AND status = 'active'
       AND ($3::uuid IS NULL OR staff_id = $3::uuid)
     RETURNING *`,
    [orgId, id, staffId]
  );
  return r.rows[0] || null;
}

export async function listProxySessions(db, {
  orgId,
  clientId = null,
  staffId = null,
  status = null,
  limit = 50,
  offset = 0
} = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const r = await db.query(
    `SELECT id, org_id, client_id, staff_id, lender_id, application_id,
            requested_city, requested_state, granted_city, granted_region,
            targeting_level, exit_ip, sessid, application_url, status,
            error_code, error_message, started_at, ended_at, created_at
       FROM proxy_sessions
      WHERE org_id = $1::uuid
        AND ($2::uuid IS NULL OR client_id = $2::uuid)
        AND ($3::uuid IS NULL OR staff_id = $3::uuid)
        AND ($4::text IS NULL OR status = $4)
      ORDER BY started_at DESC
      LIMIT $5 OFFSET $6`,
    [orgId, clientId, staffId, status, lim + 1, off]
  );
  const rows = r.rows;
  const hasMore = rows.length > lim;
  return { items: hasMore ? rows.slice(0, lim) : rows, hasMore, limit: lim, offset: off };
}

export async function getProxySession(db, { orgId, id }) {
  const r = await db.query(
    `SELECT * FROM proxy_sessions
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, id]
  );
  return r.rows[0] || null;
}

function locationFromFields(fields) {
  const cf = fields && typeof fields === "object" ? fields : {};
  const city =
    cf.business_city ||
    cf.home_city ||
    cf.city ||
    cf.mailing_city ||
    null;
  const state =
    cf.business_state ||
    cf.home_state ||
    cf.state ||
    cf.mailing_state ||
    null;
  return {
    city: city != null ? String(city).trim() || null : null,
    state: state != null ? String(state).trim() || null : null
  };
}

/** Person custom_fields first (same keys as lender match), then company rows on the file. */
export function resolveClientLocation(customFields = {}, businesses = []) {
  const fromPerson = locationFromFields(customFields);
  if (fromPerson.city || fromPerson.state) return fromPerson;
  for (const biz of Array.isArray(businesses) ? businesses : []) {
    const entity = biz && typeof biz.entity_data === "object" ? biz.entity_data : {};
    const fromBiz = locationFromFields(entity);
    if (fromBiz.city || fromBiz.state) return fromBiz;
  }
  return { city: null, state: null };
}

export async function loadClientForProxy(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT id, org_id, email, custom_fields
       FROM clients
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, clientId]
  );
  const client = r.rows[0] || null;
  if (!client) return null;
  const biz = await db.query(
    `SELECT entity_data
       FROM businesses
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY created_at ASC`,
    [orgId, clientId]
  );
  client.businesses = biz.rows;
  return client;
}

export async function loadLenderForProxy(db, { orgId, lenderId }) {
  const r = await db.query(
    `SELECT id, org_id, name, product_name, application_url, lender_table, active
       FROM lenders
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, lenderId]
  );
  return r.rows[0] || null;
}

export async function loadApplicationForProxy(db, { orgId, applicationId }) {
  const r = await db.query(
    `SELECT id, org_id, client_id, lender_id, funding_round_id,
            application_url, lender_name, status
       FROM applications
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, applicationId]
  );
  return r.rows[0] || null;
}
