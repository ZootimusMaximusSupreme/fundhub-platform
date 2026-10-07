// Merchant connections + events — every read and write of the two 442 tables.
//
// Every function takes `db` (anything with query(sql, params)) and is scoped by
// org AND client, except the two lookups an inbound webhook or API call makes
// before it knows whose it is (findActiveByApiKey, findForWebhook). Those find
// the connection by a credential, and the connection then names the client —
// and the daily pull sweeper's three (listPullConnections, getPullConnection,
// saveSync*), which walk every live pull connection by id.
import {
  newApiKey, hashApiKey, apiKeyHint, encryptWebhookSecret, decryptWebhookSecret, encryptProcessorApiKey
} from "./secrets.mjs";

export const PROVIDERS = Object.freeze(["commas", "whop", "api"]);
/* push = the processor sends to us (webhook, or the open API).
   pull = we read the processor with the client's own API key (migration 457).
   Only processors with a module in src/merchant/providers/ can pull. */
export const MODES = Object.freeze(["push", "pull"]);
export const PULL_PROVIDERS = Object.freeze(["commas", "whop"]);
export const PROVIDER_LABEL = Object.freeze({ commas: "Commas", whop: "Whop", api: "Open API" });

export class MerchantError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* The shape a connection may take on its way to a screen. Never the key hash,
   never the secret — only whether one exists. */
export function publicConnection(row, { baseUrl } = {}) {
  if (!row) return null;
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const pull = row.mode === "pull";
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return {
    id: row.id,
    provider: row.provider,
    provider_label: PROVIDER_LABEL[row.provider] || row.provider,
    mode: pull ? "pull" : "push",
    status: row.status,
    entity_id: row.entity_id,
    entity_name: row.entity_name ?? null,
    entity_kind: row.entity_kind ?? null,
    // The open-API key's last four, or the pasted processor key's last four.
    api_key_hint: row.provider === "api" || pull ? row.api_key_hint || null : null,
    has_api_key: pull ? Boolean(row.encrypted_api_key) : null,
    has_secret: row.provider === "api" || pull ? null : Boolean(row.encrypted_webhook_secret),
    webhook_url: row.provider === "api" || pull ? null : webhookUrl(base, row.provider, row.id),
    event_count: row.event_count == null ? 0 : Number(row.event_count),
    last_event_at: iso(row.last_event_at),
    last_synced_at: pull ? iso(row.last_synced_at) : null,
    last_sync_error: pull ? row.last_sync_error || null : null,
    // A pull that stopped at its page budget and carries on next time.
    sync_partway: pull ? Boolean(row.sync_cursor) : null,
    created_at: iso(row.created_at),
    disabled_at: iso(row.disabled_at)
  };
}

export function webhookUrl(baseUrl, provider, id) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/api/webhooks/merchant-${provider}/${id}`;
}

export function openApiUrl(baseUrl) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/api/merchant/events`;
}

const SELECT_CONNECTION = `
  SELECT c.id, c.org_id, c.client_id, c.entity_id, c.provider, c.mode, c.status, c.api_key_hint,
         c.encrypted_webhook_secret, c.encrypted_api_key, c.sync_cursor, c.synced_through,
         c.last_synced_at, c.last_sync_error, c.last_event_at, c.disabled_at, c.created_at,
         e.name AS entity_name, e.kind AS entity_kind,
         (SELECT count(*) FROM merchant_events me WHERE me.connection_id = c.id) AS event_count
    FROM merchant_connections c
    JOIN entities e ON e.id = c.entity_id`;

export async function listConnections(db, { orgId, clientId }) {
  const r = await db.query(
    `${SELECT_CONNECTION}
      WHERE c.org_id = $1 AND c.client_id = $2
      ORDER BY (c.status = 'disabled'), c.created_at`,
    [orgId, clientId]
  );
  return r.rows;
}

export async function listContainers(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT id, kind, name FROM entities
      WHERE org_id = $1 AND client_id = $2 AND archived_at IS NULL
      ORDER BY (kind = 'business') DESC, name`,
    [orgId, clientId]
  );
  return r.rows;
}

/* createConnection → { row, apiKey? }. The api key exists in this return value
   and nowhere else, ever. */
export async function createConnection(db, { orgId, clientId, entityId, provider, mode = "push", createdByKind = null, createdBy = null }) {
  if (!PROVIDERS.includes(provider)) throw new MerchantError("bad_provider", `provider must be one of ${PROVIDERS.join(", ")}`);
  if (!MODES.includes(mode)) throw new MerchantError("bad_mode", "mode must be push or pull");
  if (mode === "pull" && !PULL_PROVIDERS.includes(provider)) {
    throw new MerchantError("bad_mode", "Only Commas and Whop can be read with an API key. Use the open API for other processors.");
  }
  const ent = await db.query(
    `SELECT id, kind, name FROM entities
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND archived_at IS NULL`,
    [entityId, orgId, clientId]
  );
  if (!ent.rows[0]) throw new MerchantError("bad_container", "That container is not on this file.", 404);

  const apiKey = provider === "api" ? newApiKey() : null;
  const ins = await db.query(
    `INSERT INTO merchant_connections
        (org_id, client_id, entity_id, provider, status, api_key_hash, api_key_hint, created_by_kind, created_by, mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, org_id, client_id, entity_id, provider, mode, status, api_key_hint,
               encrypted_webhook_secret, encrypted_api_key, sync_cursor, synced_through,
               last_synced_at, last_sync_error, last_event_at, disabled_at, created_at`,
    [
      orgId, clientId, entityId, provider,
      provider === "api" ? "active" : "waiting",
      apiKey ? hashApiKey(apiKey) : null,
      apiKey ? apiKeyHint(apiKey) : null,
      createdByKind, createdBy,
      provider === "api" ? "push" : mode
    ]
  );
  const row = { ...ins.rows[0], entity_name: ent.rows[0].name, entity_kind: ent.rows[0].kind, event_count: 0 };
  return { row, apiKey };
}

async function ownConnection(db, { orgId, clientId, connectionId }) {
  const r = await db.query(
    `${SELECT_CONNECTION} WHERE c.id = $1 AND c.org_id = $2 AND c.client_id = $3`,
    [connectionId, orgId, clientId]
  );
  if (!r.rows[0]) throw new MerchantError("not_found", "That connection is not on this file.", 404);
  return r.rows[0];
}

/* setWebhookSecret — the client pastes the signing secret Whop or Commas
   showed them. Stored encrypted; the connection goes live. */
export async function setWebhookSecret(db, { orgId, clientId, connectionId, secret, env = process.env }) {
  const row = await ownConnection(db, { orgId, clientId, connectionId });
  if (row.provider === "api") throw new MerchantError("no_secret_for_api", "An open-API connection uses its key, not a webhook secret.");
  if (row.mode === "pull") throw new MerchantError("no_secret_for_pull", "This connection reads with your API key. It does not use a webhook secret.");
  if (row.status === "disabled") throw new MerchantError("disabled", "That connection is turned off.", 409);
  const s = String(secret || "").trim();
  if (s.length < 8 || s.length > 500) throw new MerchantError("bad_secret", "Paste the full signing secret from the processor.");
  const enc = encryptWebhookSecret(s, { connectionId: row.id, env });
  await db.query(
    `UPDATE merchant_connections
        SET encrypted_webhook_secret = $1, status = 'active'
      WHERE id = $2 AND org_id = $3 AND client_id = $4`,
    [enc, row.id, orgId, clientId]
  );
  return { ...row, encrypted_webhook_secret: enc, status: "active" };
}

/* setProcessorApiKey — the client pastes their Commas or Whop API key on a
   pull connection. Stored encrypted (secrets.mjs encryptProcessorApiKey), the
   last four kept as a hint; the connection goes live. A new key clears the old
   error and any half-finished pull, so the next sync starts clean. */
export async function setProcessorApiKey(db, { orgId, clientId, connectionId, apiKey, env = process.env }) {
  const row = await ownConnection(db, { orgId, clientId, connectionId });
  if (row.mode !== "pull") {
    throw new MerchantError("not_pull", "This connection takes a webhook signing secret, not an API key. Add a new connection and choose \"Paste your API key\".");
  }
  if (row.status === "disabled") throw new MerchantError("disabled", "That connection is turned off.", 409);
  const k = String(apiKey || "").trim();
  if (k.length < 8 || k.length > 1000 || /\s/.test(k)) throw new MerchantError("bad_api_key", "Paste the full API key from the processor.");
  const enc = encryptProcessorApiKey(k, { connectionId: row.id, env });
  const hint = apiKeyHint(k);
  await db.query(
    `UPDATE merchant_connections
        SET encrypted_api_key = $1, api_key_hint = $2, status = 'active',
            sync_cursor = NULL, last_sync_error = NULL
      WHERE id = $3 AND org_id = $4 AND client_id = $5`,
    [enc, hint, row.id, orgId, clientId]
  );
  return { ...row, encrypted_api_key: enc, api_key_hint: hint, status: "active", sync_cursor: null, last_sync_error: null };
}

/* getOwnConnection — one connection on this client's file (404 otherwise). */
export async function getOwnConnection(db, { orgId, clientId, connectionId }) {
  return ownConnection(db, { orgId, clientId, connectionId });
}

/* listPullConnections — every live pull connection, least recently synced
   first. The daily sweeper's whole work list. */
export async function listPullConnections(db) {
  const r = await db.query(
    `SELECT id, org_id, client_id
       FROM merchant_connections
      WHERE mode = 'pull' AND status = 'active' AND encrypted_api_key IS NOT NULL
      ORDER BY last_synced_at NULLS FIRST, created_at`
  );
  return r.rows;
}

/* getPullConnection — one live pull connection with its stored (encrypted)
   key and sync bookkeeping, by id alone. Only the sweeper calls this, with an
   id it just read from listPullConnections. */
export async function getPullConnection(db, connectionId) {
  const r = await db.query(
    `SELECT id, org_id, client_id, entity_id, provider, mode, status, encrypted_api_key,
            sync_cursor, synced_through, last_synced_at
       FROM merchant_connections
      WHERE id = $1 AND mode = 'pull' AND status = 'active'`,
    [connectionId]
  );
  return r.rows[0] || null;
}

/* saveSyncProgress — after each page a pull reads. `cursor` null means the
   pull finished, and `completedAt` becomes synced_through. */
export async function saveSyncProgress(db, connectionId, { cursor = null, completedAt = null } = {}) {
  await db.query(
    `UPDATE merchant_connections
        SET sync_cursor = $2, last_synced_at = now(), last_sync_error = NULL,
            synced_through = COALESCE($3::timestamptz, synced_through)
      WHERE id = $1`,
    [connectionId, cursor, completedAt]
  );
}

/* saveSyncError — the failure in plain words (never a key), at most 300
   characters. The cursor stays where it was, so the next pull resumes. */
export async function saveSyncError(db, connectionId, message) {
  await db.query(
    `UPDATE merchant_connections SET last_sync_error = $2 WHERE id = $1`,
    [connectionId, String(message || "The last sync failed.").slice(0, 300)]
  );
}

export async function disableConnection(db, { orgId, clientId, connectionId }) {
  const row = await ownConnection(db, { orgId, clientId, connectionId });
  if (row.status === "disabled") return row;
  const r = await db.query(
    `UPDATE merchant_connections
        SET status = 'disabled', disabled_at = now()
      WHERE id = $1 AND org_id = $2 AND client_id = $3
      RETURNING disabled_at`,
    [row.id, orgId, clientId]
  );
  return { ...row, status: "disabled", disabled_at: r.rows[0]?.disabled_at ?? new Date() };
}

/* findActiveByApiKey — the open API's whole credential check. */
export async function findActiveByApiKey(db, key) {
  const k = String(key || "");
  if (!k.startsWith("fhm_") || k.length < 20 || k.length > 200) return null;
  const r = await db.query(
    `SELECT id, org_id, client_id, entity_id, provider, status
       FROM merchant_connections
      WHERE api_key_hash = $1 AND provider = 'api' AND status = 'active'`,
    [hashApiKey(k)]
  );
  return r.rows[0] || null;
}

/* findForWebhook — a live webhook connection plus its decrypted secret. */
export async function findForWebhook(db, { connectionId, provider, env = process.env }) {
  const r = await db.query(
    `SELECT id, org_id, client_id, entity_id, provider, status, encrypted_webhook_secret
       FROM merchant_connections
      WHERE id = $1 AND provider = $2 AND status = 'active'`,
    [connectionId, provider]
  );
  const row = r.rows[0];
  if (!row || !row.encrypted_webhook_secret) return null;
  const secret = decryptWebhookSecret(row.encrypted_webhook_secret, { connectionId: row.id, env });
  const { encrypted_webhook_secret: _drop, ...safe } = row;
  return { connection: safe, secret };
}

/* recordEvents — insert each event once. A repeat (same connection, same
   provider_event_id) is counted as a duplicate and changes nothing. */
export async function recordEvents(db, connection, events) {
  let inserted = 0;
  let duplicates = 0;
  const ids = [];
  for (const e of events || []) {
    const r = await db.query(
      `INSERT INTO merchant_events
          (connection_id, provider_event_id, kind, amount_cents, currency, occurred_at, description, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (connection_id, provider_event_id) DO NOTHING
       RETURNING id`,
      [
        connection.id, e.provider_event_id, e.kind, e.amount_cents, e.currency,
        e.occurred_at, e.description ?? null, e.raw === undefined || e.raw === null ? null : JSON.stringify(e.raw)
      ]
    );
    if (r.rows[0]) { inserted++; ids.push(r.rows[0].id); } else { duplicates++; }
  }
  if (inserted > 0) {
    await db.query(`UPDATE merchant_connections SET last_event_at = now() WHERE id = $1`, [connection.id]);
  }
  return { inserted, duplicates, ids };
}

/* ═════════════════════════════════════════════════════════════════════════
   merchantSummary(db, { orgId, clientId, months = 6, asOf }) — the read Finance
   OS shows. Month over month, per container, plus an all-containers total.

   {
     currency: "usd",
     months: ["2026-05", …, "2026-10"],            oldest first, asOf's month last
     containers: [{
       entity_id, name, kind,
       months: [{ month, sales_cents, refunds_cents, fees_cents, payouts_cents,
                  net_cents, sale_count }]
     }],
     totals: [{ month, sales_cents, refunds_cents, fees_cents, payouts_cents, net_cents, sale_count }],
     other_currency_events: <int>,               events not in usd, not added in
     last_event_at: <iso|null>
   }

   refunds/fees/payouts are reported as POSITIVE amounts (what left), and
   net = sales − refunds − fees. Payouts move money to the bank; they are not
   a loss, so they are not taken out of net. A month with no events is zeros,
   because the connection was live and nothing happened — but a container with
   no connection is not listed at all.
   ═════════════════════════════════════════════════════════════════════════ */
export function monthKeys(asOf = new Date(), n = 6) {
  const d = new Date(asOf);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(Date.UTC(y, m - i, 1));
    out.push(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function blankMonth(month) {
  return { month, sales_cents: 0, refunds_cents: 0, fees_cents: 0, payouts_cents: 0, net_cents: 0, sale_count: 0 };
}

export function buildSummary({ rows = [], connections = [], otherCurrency = 0, asOf = new Date(), months = 6 }) {
  const keys = monthKeys(asOf, months);
  const byEntity = new Map();
  for (const c of connections) {
    if (!byEntity.has(c.entity_id)) {
      byEntity.set(c.entity_id, {
        entity_id: c.entity_id, name: c.entity_name ?? null, kind: c.entity_kind ?? null,
        months: keys.map(blankMonth)
      });
    }
  }
  const totals = keys.map(blankMonth);
  for (const r of rows) {
    const idx = keys.indexOf(r.month);
    if (idx < 0) continue;
    const ent = byEntity.get(r.entity_id);
    const cents = Number(r.cents);
    const count = Number(r.n);
    for (const target of [ent ? ent.months[idx] : null, totals[idx]]) {
      if (!target) continue;
      if (r.kind === "sale") { target.sales_cents += cents; target.sale_count += count; }
      else if (r.kind === "refund") target.refunds_cents += -cents;
      else if (r.kind === "fee") target.fees_cents += -cents;
      else if (r.kind === "payout") target.payouts_cents += -cents;
      target.net_cents = target.sales_cents - target.refunds_cents - target.fees_cents;
    }
  }
  let last = null;
  for (const c of connections) {
    const t = c.last_event_at ? new Date(c.last_event_at).toISOString() : null;
    if (t && (!last || t > last)) last = t;
  }
  return {
    currency: "usd",
    months: keys,
    containers: [...byEntity.values()],
    totals,
    other_currency_events: Number(otherCurrency) || 0,
    last_event_at: last
  };
}

export async function merchantSummary(db, { orgId, clientId, months = 6, asOf = new Date(), connections = null }) {
  const keys = monthKeys(asOf, months);
  const from = `${keys[0]}-01`;
  const conns = connections || (await listConnections(db, { orgId, clientId }));
  const r = await db.query(
    `SELECT c.entity_id,
            to_char(date_trunc('month', me.occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
            me.kind,
            sum(me.amount_cents)::bigint AS cents,
            count(*)::int AS n
       FROM merchant_events me
       JOIN merchant_connections c ON c.id = me.connection_id
      WHERE c.org_id = $1 AND c.client_id = $2
        AND me.currency = 'usd'
        AND me.occurred_at >= $3::date
      GROUP BY 1, 2, 3`,
    [orgId, clientId, from]
  );
  const other = await db.query(
    `SELECT count(*)::int AS n
       FROM merchant_events me
       JOIN merchant_connections c ON c.id = me.connection_id
      WHERE c.org_id = $1 AND c.client_id = $2 AND me.currency <> 'usd'
        AND me.occurred_at >= $3::date`,
    [orgId, clientId, from]
  );
  return buildSummary({ rows: r.rows, connections: conns, otherCurrency: other.rows[0]?.n ?? 0, asOf, months });
}
