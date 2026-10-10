// TESTS AND PROOF ONLY — an in-memory stand-in for the two 442 tables plus the
// entities and clients rows they lean on. It answers exactly the SQL that
// src/merchant/store.mjs and src/http/client-scope.mjs send, by pattern, and
// throws on anything else so a new query cannot pass silently.
//
// Not imported by any runtime file. It exists because migration 442 is not on
// the one (production) database until the orchestrator ships, and the handlers
// still have to be proved end to end before then.
import crypto from "node:crypto";

export function memoryDb({ clients = [], entities = [] } = {}) {
  const state = {
    clients: clients.map((c) => ({ ...c })),
    entities: entities.map((e) => ({ archived_at: null, ...e })),
    connections: [],
    events: [],
    log: []
  };
  const ent = (id) => state.entities.find((e) => e.id === id);
  const countFor = (cid) => state.events.filter((e) => e.connection_id === cid).length;
  const joined = (c) => ({ ...c, entity_name: ent(c.entity_id)?.name ?? null, entity_kind: ent(c.entity_id)?.kind ?? null, event_count: countFor(c.id) });
  const month = (iso) => new Date(iso).toISOString().slice(0, 7);

  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, " ").trim();
    state.log.push({ sql: s, params });

    if (/FROM clients/i.test(s)) {
      const hit = state.clients.find((c) => c.id === params[0] && (params[1] === undefined || c.org_id === params[1]));
      return { rows: hit ? [{ "?column?": 1 }] : [] };
    }
    if (/^SELECT id, kind, name FROM entities WHERE id = \$1/.test(s)) {
      const e = state.entities.find((x) => x.id === params[0] && x.org_id === params[1] && x.client_id === params[2] && !x.archived_at);
      return { rows: e ? [{ id: e.id, kind: e.kind, name: e.name }] : [] };
    }
    if (/^SELECT id, kind, name FROM entities WHERE org_id = \$1/.test(s)) {
      return { rows: state.entities.filter((x) => x.org_id === params[0] && x.client_id === params[1] && !x.archived_at)
        .map(({ id, kind, name }) => ({ id, kind, name })) };
    }
    if (/^INSERT INTO merchant_connections/.test(s)) {
      const [org_id, client_id, entity_id, provider, status, api_key_hash, api_key_hint, created_by_kind, created_by, mode = "push"] = params;
      const e = ent(entity_id);
      if (!e || e.client_id !== client_id || e.org_id !== org_id) {
        const err = new Error("merchant_connections: entity does not belong to client"); err.code = "23514"; throw err;
      }
      // 457 merchant_connections_pull_provider
      if (mode === "pull" && provider !== "commas" && provider !== "whop") {
        const err = new Error("merchant_connections_pull_provider"); err.code = "23514"; throw err;
      }
      const row = {
        id: crypto.randomUUID(), org_id, client_id, entity_id, provider, mode, status, api_key_hash, api_key_hint,
        encrypted_webhook_secret: null, encrypted_api_key: null, sync_cursor: null, synced_through: null,
        last_synced_at: null, last_sync_error: null,
        created_by_kind, created_by, last_event_at: null, disabled_at: null, created_at: new Date()
      };
      state.connections.push(row);
      return { rows: [{ ...row }] };
    }
    if (/FROM merchant_connections c JOIN entities e ON e.id = c.entity_id WHERE c.org_id = \$1 AND c.client_id = \$2/.test(s)) {
      return { rows: state.connections.filter((c) => c.org_id === params[0] && c.client_id === params[1]).map(joined) };
    }
    if (/FROM merchant_connections c JOIN entities e ON e.id = c.entity_id WHERE c.id = \$1 AND c.org_id = \$2 AND c.client_id = \$3/.test(s)) {
      const c = state.connections.find((x) => x.id === params[0] && x.org_id === params[1] && x.client_id === params[2]);
      return { rows: c ? [joined(c)] : [] };
    }
    if (/^UPDATE merchant_connections SET encrypted_webhook_secret = \$1, status = 'active'/.test(s)) {
      const c = state.connections.find((x) => x.id === params[1] && x.org_id === params[2] && x.client_id === params[3]);
      if (c) { c.encrypted_webhook_secret = params[0]; c.status = "active"; }
      return { rows: [], rowCount: c ? 1 : 0 };
    }
    if (/^UPDATE merchant_connections SET encrypted_api_key = \$1, api_key_hint = \$2, status = 'active'/.test(s)) {
      const c = state.connections.find((x) => x.id === params[2] && x.org_id === params[3] && x.client_id === params[4]);
      if (c) {
        // 457 merchant_connections_push_no_api_key
        if (c.mode !== "pull") { const err = new Error("merchant_connections_push_no_api_key"); err.code = "23514"; throw err; }
        Object.assign(c, { encrypted_api_key: params[0], api_key_hint: params[1], status: "active", sync_cursor: null, last_sync_error: null });
      }
      return { rows: [], rowCount: c ? 1 : 0 };
    }
    if (/^UPDATE merchant_connections SET sync_cursor = \$2, last_synced_at = now\(\), last_sync_error = NULL/.test(s)) {
      const c = state.connections.find((x) => x.id === params[0]);
      if (c) {
        c.sync_cursor = params[1];
        c.last_synced_at = new Date();
        c.last_sync_error = null;
        if (params[2]) c.synced_through = new Date(params[2]);
      }
      return { rows: [], rowCount: c ? 1 : 0 };
    }
    if (/^UPDATE merchant_connections SET last_sync_error = \$2 WHERE id = \$1/.test(s)) {
      const c = state.connections.find((x) => x.id === params[0]);
      if (c) c.last_sync_error = params[1];
      return { rows: [], rowCount: c ? 1 : 0 };
    }
    if (/^SELECT id, org_id, client_id FROM merchant_connections WHERE mode = 'pull' AND status = 'active'/.test(s)) {
      return { rows: state.connections
        .filter((c) => c.mode === "pull" && c.status === "active" && c.encrypted_api_key)
        .sort((a, b) => (a.last_synced_at ? +a.last_synced_at : -Infinity) - (b.last_synced_at ? +b.last_synced_at : -Infinity))
        .map(({ id, org_id, client_id }) => ({ id, org_id, client_id })) };
    }
    if (/FROM merchant_connections WHERE id = \$1 AND mode = 'pull' AND status = 'active'/.test(s)) {
      const c = state.connections.find((x) => x.id === params[0] && x.mode === "pull" && x.status === "active");
      return { rows: c ? [{ ...c }] : [] };
    }
    if (/^UPDATE merchant_connections SET status = 'disabled'/.test(s)) {
      const c = state.connections.find((x) => x.id === params[0] && x.org_id === params[1] && x.client_id === params[2]);
      if (c) { c.status = "disabled"; c.disabled_at = new Date(); }
      return { rows: c ? [{ disabled_at: c.disabled_at }] : [] };
    }
    if (/WHERE api_key_hash = \$1 AND provider = 'api' AND status = 'active'/.test(s)) {
      const c = state.connections.find((x) => x.api_key_hash === params[0] && x.provider === "api" && x.status === "active");
      return { rows: c ? [{ id: c.id, org_id: c.org_id, client_id: c.client_id, entity_id: c.entity_id, provider: c.provider, status: c.status }] : [] };
    }
    if (/FROM merchant_connections WHERE id = \$1 AND provider = \$2 AND status = 'active'/.test(s)) {
      const c = state.connections.find((x) => x.id === params[0] && x.provider === params[1] && x.status === "active");
      return { rows: c ? [{ ...c }] : [] };
    }
    if (/^INSERT INTO merchant_events/.test(s)) {
      const [connection_id, provider_event_id, kind, amount_cents, currency, occurred_at, description, raw] = params;
      if (kind === "sale" && amount_cents < 0) { const err = new Error("sale sign"); err.code = "23514"; throw err; }
      if ((kind === "refund" || kind === "fee") && amount_cents > 0) { const err = new Error("refund sign"); err.code = "23514"; throw err; }
      if (state.events.some((e) => e.connection_id === connection_id && e.provider_event_id === provider_event_id)) return { rows: [] };
      const row = { id: crypto.randomUUID(), connection_id, provider_event_id, kind, amount_cents, currency, occurred_at, description, raw };
      state.events.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (/^UPDATE merchant_connections SET last_event_at = now\(\) WHERE id = \$1/.test(s)) {
      const c = state.connections.find((x) => x.id === params[0]);
      if (c) c.last_event_at = new Date();
      return { rows: [] };
    }
    if (/sum\(me.amount_cents\)/.test(s)) {
      const [org, client, from] = params;
      const groups = new Map();
      for (const e of state.events) {
        const c = state.connections.find((x) => x.id === e.connection_id);
        if (!c || c.org_id !== org || c.client_id !== client || e.currency !== "usd") continue;
        if (new Date(e.occurred_at) < new Date(`${from}T00:00:00Z`)) continue;
        const k = `${c.entity_id}|${month(e.occurred_at)}|${e.kind}`;
        const g = groups.get(k) || { entity_id: c.entity_id, month: month(e.occurred_at), kind: e.kind, cents: 0, n: 0 };
        g.cents += Number(e.amount_cents); g.n += 1;
        groups.set(k, g);
      }
      return { rows: [...groups.values()] };
    }
    if (/me.currency <> 'usd'/.test(s)) {
      const [org, client, from] = params;
      const n = state.events.filter((e) => {
        const c = state.connections.find((x) => x.id === e.connection_id);
        return c && c.org_id === org && c.client_id === client && e.currency !== "usd" && new Date(e.occurred_at) >= new Date(`${from}T00:00:00Z`);
      }).length;
      return { rows: [{ n }] };
    }
    throw new Error(`memoryDb: unhandled SQL: ${s.slice(0, 120)}`);
  }

  return { query, state };
}
